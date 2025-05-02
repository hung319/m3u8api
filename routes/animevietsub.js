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
const BASE_URL = `http://localhost:3000`; // Sẽ được thay đổi động sau

// --- TỰ ĐỘNG TẠO THƯ MỤC TẠM ---
if (!fs.existsSync(TEMP_DIR_PATH)) {
    try {
        fs.mkdirSync(TEMP_DIR_PATH);
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

// --- HÀM GIẢI MÃ (Sao chép toàn bộ hàm này vào) ---
function decryptAndDecompress(encrypted_data_string_b64) {
    // ... (Giữ nguyên toàn bộ nội dung hàm decryptAndDecompress từ phản hồi trước) ...
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
        let m3u8_content_raw = decompressed_bytes.toString('utf8'); // Dữ liệu gốc sau giải nén

        // Xử lý chuỗi M3U8 theo yêu cầu mới
        console.log('[AnimeVietsub] Đang xử lý nội dung M3U8...');
        m3u8_content_raw = m3u8_content_raw.trim().replace(/^"|"$/g, ''); // Xóa dấu " đầu/cuối
        m3u8_content_raw = m3u8_content_raw.replace(/\\n/g, '\n'); // Thay thế \n thành newline
        console.log('[AnimeVietsub] Đã xử lý xong nội dung M3U8.');

        return m3u8_content_raw;
    } catch (error) {
        console.error("\n[AnimeVietsub] Lỗi giải mã/giải nén:", error.message);
        console.error("[AnimeVietsub] Dữ liệu đầu vào (50 ký tự đầu):", cleaned_encdata_b64.substring(0, 50) + "...");
        throw new Error(`Giải mã thất bại: ${error.message}`);
    }
}

// --- MIDDLEWARE CHO ROUTE /decrypt (Thêm dòng này) ---
router.use('/decrypt', express.text({ type: '*/*' }));

// --- THÊM CÁC ROUTE MỚI NÀY VÀO ---

// Route POST để giải mã
router.post('/decrypt', async (req, res) => {
    // ... (Giữ nguyên toàn bộ nội dung route POST /decrypt từ phản hồi trước) ...
     console.log(`\n[AnimeVietsub] Nhận POST /decrypt lúc ${new Date().toISOString()}`);
    const encryptedDataString = req.body;
    if (typeof encryptedDataString !== 'string' || !encryptedDataString) {
        console.error('[AnimeVietsub] Lỗi: Request body trống hoặc không phải dạng text.');
        return res.status(400).type('text/plain; charset=utf-8').send('Lỗi: Request body trống hoặc không phải dạng text.');
    }
    console.log(`[AnimeVietsub] Dữ liệu nhận được (50 ký tự đầu): ${encryptedDataString.substring(0, 50)}...`);
    try {
        const m3u8Content = decryptAndDecompress(encryptedDataString); // Đã bao gồm xử lý chuỗi
        const randomFilename = `${crypto.randomBytes(16).toString('hex')}.m3u8`;
        const filePath = path.join(TEMP_DIR_PATH, randomFilename);
        const requestBaseUrl = `${req.protocol}://${req.get('host')}`;
        const publicUrl = `${requestBaseUrl}/animevietsub/files/${randomFilename}`;

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
        console.error("[AnimeVietsub] Lỗi xử lý:", error.message);
        res.status(500).type('text/plain; charset=utf-8').send(`Lỗi Server Nội Bộ: ${error.message}`);
    }
});

// Route GET để phục vụ file M3U8
router.get('/files/:filename', async (req, res) => {
    // ... (Giữ nguyên toàn bộ nội dung route GET /files/:filename từ phản hồi trước) ...
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
                 'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8', // Hoặc application/x-mpegURL
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
// module.exports = router;
