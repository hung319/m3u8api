const express = require('express'); // Bạn có thể đã có dòng này
const crypto = require('crypto');
const zlib = require('zlib');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { Buffer } = require('buffer');

// Giữ lại dòng này nếu bạn đã có:
const router = express.Router();

// --- CẤU HÌNH ---
const TEMP_DIR_NAME = 'temp_m3u8';
const TEMP_DIR_PATH = path.join(__dirname, '..', TEMP_DIR_NAME); // Đường dẫn thư mục tạm
const FILE_EXPIRATION_MS = 12 * 60 * 60 * 1000; // 12 giờ
// const BASE_URL = `http://0.0.0.0:3000`; // Sẽ được thay đổi động sau (dòng này không còn cần thiết cho publicUrl nếu bạn dùng req.get('host'))

// URL Proxy của bạn
const PROXY_URL_BASE = 'https://prxclf.013666.xyz/'; // Thay đổi nếu cần

// --- TỰ ĐỘNG TẠO THƯ MỤC TẠM ---
if (!fs.existsSync(TEMP_DIR_PATH)) {
    try {
        fs.mkdirSync(TEMP_DIR_PATH, { recursive: true }); // Thêm recursive true cho chắc chắn
        console.log(`[AnimeVietsub] Đã tự động tạo thư mục tạm: ${TEMP_DIR_PATH}`);
    } catch (err) {
        console.error(`[AnimeVietsub] Lỗi nghiêm trọng khi tạo thư mục tạm tại ${TEMP_DIR_PATH}. Lỗi: ${err}`);
        process.exit(1);
    }
} else {
     console.log(`[AnimeVietsub] Thư mục tạm đã tồn tại: ${TEMP_DIR_PATH}`);
}

// Khóa gốc (Base64 encoded)
const key_string_b64 = "ZG1fdGhhbmdfc3VjX3ZhdF9nZXRfbGlua19hbl9kYnQ=";
let aes_key_bytes = null;

// --- HÀM TÍNH KHÓA AES (Chạy 1 lần) ---
function calculateAesKey() {
     if (!aes_key_bytes) {
         try {
             const decoded_key_bytes = Buffer.from(key_string_b64, 'base64');
             const sha256Hasher = crypto.createHash('sha256');
             sha256Hasher.update(decoded_key_bytes);
             aes_key_bytes = sha256Hasher.digest();
             console.log('[AnimeVietsub] Khóa AES đã được tính toán.');
         } catch(e) {
             console.error('[AnimeVietsub] Không thể tính toán khóa AES:', e);
             throw new Error('Lỗi cấu hình khóa AES.');
         }
     }
}
calculateAesKey();

// --- HÀM GIẢI MÃ ---
function decryptAndDecompress(encrypted_data_string_b64) {
    if (!aes_key_bytes) {
        throw new Error('Khóa AES chưa được khởi tạo.');
    }
    const cleaned_encdata_b64 = encrypted_data_string_b64.replace(/[^A-Za-z0-9+/=]/g, '');
    try {
        const encrypted_bytes = Buffer.from(cleaned_encdata_b64, 'base64');
        if (encrypted_bytes.length < 16) throw new Error('Dữ liệu mã hóa không đủ dài để chứa IV.');
        const iv_bytes = encrypted_bytes.subarray(0, 16);
        const ciphertext_bytes = encrypted_bytes.subarray(16);
        const decipher = crypto.createDecipheriv('aes-256-cbc', aes_key_bytes, iv_bytes);
        let decrypted_bytes_padded = decipher.update(ciphertext_bytes);
        decrypted_bytes_padded = Buffer.concat([decrypted_bytes_padded, decipher.final()]);
        const decompressed_bytes = zlib.inflateRawSync(decrypted_bytes_padded);
        let m3u8_content_raw = decompressed_bytes.toString('utf8');

        console.log('[AnimeVietsub] Đang xử lý nội dung M3U8...');
        m3u8_content_raw = m3u8_content_raw.trim().replace(/^"|"$/g, '');
        m3u8_content_raw = m3u8_content_raw.replace(/\\n/g, '\n');
        console.log('[AnimeVietsub] Đã xử lý xong nội dung M3U8 ban đầu.');

        return m3u8_content_raw;
    } catch (error) {
        console.error("\n[AnimeVietsub] Lỗi giải mã/giải nén:", error.message);
        console.error("[AnimeVietsub] Dữ liệu đầu vào (50 ký tự đầu):", cleaned_encdata_b64.substring(0, 50) + "...");
        throw new Error(`Giải mã thất bại: ${error.message}`);
    }
}

// --- MIDDLEWARE CHO ROUTE /decrypt (Thêm dòng này) ---
router.use('/decrypt', express.text({ type: '*/*' }));

// --- CÁC ROUTE ---

// Route POST để giải mã và thêm proxy
router.post('/decrypt', async (req, res) => {
    console.log(`\n[AnimeVietsub] Nhận POST /decrypt lúc ${new Date().toISOString()}`);
    const encryptedDataString = req.body;

    if (typeof encryptedDataString !== 'string' || !encryptedDataString) {
        console.error('[AnimeVietsub] Lỗi: Request body trống hoặc không phải dạng text.');
        return res.status(400).type('text/plain; charset=utf-8').send('Lỗi: Request body trống hoặc không phải dạng text.');
    }
    console.log(`[AnimeVietsub] Dữ liệu nhận được (50 ký tự đầu): ${encryptedDataString.substring(0, 50)}...`);

    // Lấy PROXY_API_KEY từ biến môi trường
    const apiKey = process.env.PROXY_API_KEY;
    if (!apiKey) {
        console.error('[AnimeVietsub] Lỗi nghiêm trọng: PROXY_API_KEY chưa được cấu hình trong biến môi trường.');
        return res.status(500).type('text/plain; charset=utf-8').send('Lỗi Server: Cấu hình proxy bị thiếu. Vui lòng liên hệ quản trị viên.');
    }

    try {
        let m3u8Content = decryptAndDecompress(encryptedDataString); // Đã bao gồm xử lý chuỗi cơ bản

        // Lấy referer từ request của người dùng
        const referer = req.headers.referer || ''; // Nếu không có referer, dùng chuỗi rỗng
        console.log(`[AnimeVietsub] Referer nhận được: ${referer}`);

        // Xử lý thêm proxy vào các URL trong M3U8
        const lines = m3u8Content.split('\n');
        const processedLines = lines.map(line => {
            const trimmedLine = line.trim();
            // Chỉ xử lý các dòng không phải comment (#) và không rỗng
            // Đây là cách đơn giản để xác định URL, có thể cần phức tạp hơn nếu M3U8 có cấu trúc đặc biệt
            if (trimmedLine && !trimmedLine.startsWith('#')) {
                const originalUrl = trimmedLine;
                // Tạo URL proxy mới
                const proxiedUrl = `${PROXY_URL_BASE}?url=${encodeURIComponent(originalUrl)}&referer=${encodeURIComponent(referer)}&auth_token=${apiKey}`;
                console.log(`[AnimeVietsub] Gốc: ${originalUrl} -> Proxy: ${proxiedUrl.substring(0,100)}...`); // Log một phần để tránh quá dài
                return proxiedUrl;
            }
            return line; // Giữ nguyên các dòng comment hoặc dòng trống
        });
        m3u8Content = processedLines.join('\n');
        console.log('[AnimeVietsub] Đã thêm proxy vào các URL trong M3U8.');

        const randomFilename = `${crypto.randomBytes(16).toString('hex')}.m3u8`;
        const filePath = path.join(TEMP_DIR_PATH, randomFilename);
        
        // Xác định scheme (http hoặc https)
        const scheme = req.protocol; // 'http' hoặc 'https' (nếu server Express đứng sau reverse proxy như Nginx và được cấu hình đúng `trust proxy`)
                                     // Hoặc bạn có thể fix cứng là 'https' nếu bạn biết chắc chắn
        const requestHost = req.get('host');
        const publicUrl = `${scheme}://${requestHost}/animevietsub/files/${randomFilename}`; // Sử dụng scheme động

        await fsp.writeFile(filePath, m3u8Content, 'utf8');
        console.log(`[AnimeVietsub] Đã lưu file xử lý vào: ${filePath}`);
        console.log(`[AnimeVietsub] URL trả về: ${publicUrl}`);

        setTimeout(() => {
            fsp.unlink(filePath)
                .then(() => console.log(`[AnimeVietsub] Đã tự động xóa file hết hạn: ${filePath}`))
                .catch(unlinkErr => console.error(`[AnimeVietsub] Lỗi khi tự động xóa file ${filePath}:`, unlinkErr));
        }, FILE_EXPIRATION_MS);

        res.status(200).type('text/plain; charset=utf-8').send(publicUrl);

    } catch (error) {
        console.error("[AnimeVietsub] Lỗi xử lý chính:", error.message);
        res.status(500).type('text/plain; charset=utf-8').send(`Lỗi Server Nội Bộ: ${error.message}`);
    }
});

// Route GET để phục vụ file M3U8 (giữ nguyên)
router.get('/files/:filename', async (req, res) => {
    const requestedFilename = path.basename(req.params.filename || '');
    const filePath = path.join(TEMP_DIR_PATH, requestedFilename);
    console.log(`\n[AnimeVietsub] Nhận GET /files/${requestedFilename} lúc ${new Date().toISOString()}`);

    if (!/^[a-f0-9]{32}\.m3u8$/.test(requestedFilename)) {
        console.warn(`[AnimeVietsub] Tên file không hợp lệ: ${requestedFilename}`);
        return res.status(400).type('text/plain; charset=utf-8').send('Bad request: Invalid filename format.');
    }

    try {
        await fsp.access(filePath, fs.constants.R_OK);
        console.log(`[AnimeVietsub] Đang phục vụ file: ${filePath}`);
        res.status(200).sendFile(filePath, {
            headers: {
                'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
                'Access-Control-Allow-Origin': '*'
            }
        }, (err) => {
            if (err) {
                console.error(`[AnimeVietsub] Lỗi khi gửi file ${filePath}:`, err);
                if (!res.headersSent) {
                    res.status(err.status || 500).send('Lỗi khi gửi file.');
                }
            } else {
                console.log(`[AnimeVietsub] Đã gửi xong file: ${filePath}`);
            }
        });
    } catch (error) {
        console.warn(`[AnimeVietsub] File không tồn tại hoặc không đọc được: ${filePath}`);
        res.status(404).type('text/plain; charset=utf-8').send('File not found or expired.');
    }
});

// --- GIỮ LẠI DÒNG NÀY Ở CUỐI TỆP ---
module.exports = router;
