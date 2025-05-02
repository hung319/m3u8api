const express = require('express');
const crypto = require('crypto');
const zlib = require('zlib');
const fs = require('fs');
const fsp = fs.promises; // Sử dụng promises API của fs cho async/await
const path = require('path');
const { Buffer } = require('buffer');

const router = express.Router();

// --- CẤU HÌNH ---
const TEMP_DIR_NAME = 'temp_m3u8'; // Tên thư mục lưu file m3u8 tạm
const TEMP_DIR_PATH = path.join(__dirname, '..', TEMP_DIR_NAME); // Đường dẫn thư mục tạm (lùi 1 cấp từ routes)
const FILE_EXPIRATION_MS = 12 * 60 * 60 * 1000; // 12 giờ
// BASE_URL sẽ được tạo động dựa trên request

// --- KIỂM TRA VÀ TẠO THƯ MỤC TẠM KHI MODULE ĐƯỢC LOAD ---
if (!fs.existsSync(TEMP_DIR_PATH)) {
    try {
        fs.mkdirSync(TEMP_DIR_PATH);
        console.log(`[AnimeVietsub Route] Đã tự động tạo thư mục tạm: ${TEMP_DIR_PATH}`);
    } catch (err) {
        console.error(`[AnimeVietsub Route] Lỗi nghiêm trọng: Không thể tạo thư mục tạm tại ${TEMP_DIR_PATH}. Lỗi: ${err}`);
        // Có thể ném lỗi hoặc xử lý khác tùy thuộc vào yêu cầu ứng dụng
        process.exit(1);
    }
} else {
     console.log(`[AnimeVietsub Route] Thư mục tạm đã tồn tại: ${TEMP_DIR_PATH}`);
}

// Khóa gốc (Base64 encoded)
const key_string_b64 = "ZG1fdGhhbmdfc3VjX3ZhdF9nZXRfbGlua19hbl9kYnQ=";
let aes_key_bytes = null; // Sẽ được tính một lần khi cần

// --- HÀM GIẢI MÃ ---
function decryptAndDecompress(encrypted_data_string_b64) {
    // Tính khóa AES một lần duy nhất nếu chưa có
    if (!aes_key_bytes) {
        try {
            const decoded_key_bytes = Buffer.from(key_string_b64, 'base64');
            const sha256Hasher = crypto.createHash('sha256');
            sha256Hasher.update(decoded_key_bytes);
            aes_key_bytes = sha256Hasher.digest();
            console.log('[AnimeVietsub Route] Khóa AES đã được tính toán.');
        } catch(e) {
            console.error('[AnimeVietsub Route] Không thể tính toán khóa AES:', e);
            throw new Error('Lỗi cấu hình khóa AES.');
        }
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
        const m3u8_content = decompressed_bytes.toString('utf8');
        return m3u8_content;

    } catch (error) {
        console.error("\n[AnimeVietsub Route] Lỗi giải mã/giải nén:", error.message);
        console.error("[AnimeVietsub Route] Dữ liệu đầu vào (50 ký tự đầu):", cleaned_encdata_b64.substring(0, 50) + "...");
        throw new Error(`Giải mã thất bại: ${error.message}`);
    }
}

// --- ĐỊNH NGHĨA ROUTES ---

// Middleware để đọc request body dạng text/plain
router.use(express.text({ type: '*/*' })); // Chấp nhận mọi content type làm text

// Route POST để giải mã
router.post('/decrypt', async (req, res) => {
    console.log(`\n[AnimeVietsub Route] Nhận POST /decrypt lúc ${new Date().toISOString()}`);
    const encryptedDataString = req.body; // Lấy dữ liệu từ body request

    if (typeof encryptedDataString !== 'string' || !encryptedDataString) {
        console.error('[AnimeVietsub Route] Lỗi: Request body trống hoặc không phải dạng text.');
        return res.status(400).type('text/plain; charset=utf-8').send('Lỗi: Request body trống hoặc không phải dạng text.');
    }

    console.log(`[AnimeVietsub Route] Dữ liệu nhận được (50 ký tự đầu): ${encryptedDataString.substring(0, 50)}...`);

    try {
        const m3u8Content = decryptAndDecompress(encryptedDataString);
        const randomFilename = `${crypto.randomBytes(16).toString('hex')}.m3u8`;
        const filePath = path.join(TEMP_DIR_PATH, randomFilename);
        // Tạo URL động dựa trên request host và protocol
        const requestBaseUrl = `${req.protocol}://${req.get('host')}`;
        const publicUrl = `${requestBaseUrl}/animevietsub/files/${randomFilename}`; // Thêm prefix '/animevietsub'

        await fsp.writeFile(filePath, m3u8Content, 'utf8');
        console.log(`[AnimeVietsub Route] Đã giải mã thành công, lưu vào: ${filePath}`);
        console.log(`[AnimeVietsub Route] URL trả về: ${publicUrl}`);

        // Lên lịch xóa file sau 12 giờ
        setTimeout(() => {
            fsp.unlink(filePath)
                .then(() => console.log(`[AnimeVietsub Route] Đã tự động xóa file hết hạn: ${filePath}`))
                .catch(unlinkErr => console.error(`[AnimeVietsub Route] Lỗi khi tự động xóa file ${filePath}:`, unlinkErr));
        }, FILE_EXPIRATION_MS);

        // Trả về URL cho người dùng
        res.status(200).type('text/plain; charset=utf-8').send(publicUrl);

    } catch (error) {
        console.error("[AnimeVietsub Route] Gửi phản hồi lỗi 500 do giải mã/lưu file thất bại.");
        res.status(500).type('text/plain; charset=utf-8').send(`Lỗi Server Nội Bộ: ${error.message}`);
    }
});

// Route GET để phục vụ file M3U8 đã lưu
router.get('/files/:filename', async (req, res) => {
    const requestedFilename = path.basename(req.params.filename || ''); // Lấy tên file, tránh directory traversal
    const filePath = path.join(TEMP_DIR_PATH, requestedFilename);

    console.log(`\n[AnimeVietsub Route] Nhận GET /files/${requestedFilename} lúc ${new Date().toISOString()}`);

    // Kiểm tra xem tên file có hợp lệ không (chỉ chứa ký tự hex và đuôi .m3u8)
    if (!/^[a-f0-9]{32}\.m3u8$/.test(requestedFilename)) {
         console.warn(`[AnimeVietsub Route] Tên file không hợp lệ: ${requestedFilename}`);
         return res.status(400).type('text/plain; charset=utf-8').send('Bad request: Invalid filename format.');
    }

    try {
        // Kiểm tra file tồn tại và có quyền đọc
        await fsp.access(filePath, fs.constants.R_OK);
        console.log(`[AnimeVietsub Route] Đang phục vụ file: ${filePath}`);
        // Phục vụ file
        res.status(200).sendFile(filePath, {
            headers: {
                'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8', // MIME type chuẩn cho HLS
                'Access-Control-Allow-Origin': '*' // Cho phép truy cập từ nguồn khác
            }
        }, (err) => {
            if (err) {
                // Lỗi xảy ra trong quá trình gửi file (hiếm khi)
                console.error(`[AnimeVietsub Route] Lỗi khi gửi file ${filePath}:`, err);
                if (!res.headersSent) {
                     res.status(500).send('Lỗi khi gửi file.');
                }
            } else {
                 console.log(`[AnimeVietsub Route] Đã gửi xong file: ${filePath}`);
            }
        });
    } catch (error) {
        // File không tồn tại hoặc không có quyền đọc
        console.warn(`[AnimeVietsub Route] File không tồn tại hoặc không đọc được: ${filePath}`);
        res.status(404).type('text/plain; charset=utf-8').send('File not found or expired.');
    }
});

module.exports = router; // Xuất router để file app chính có thể sử dụng
