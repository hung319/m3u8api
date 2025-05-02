const http = require('http');
const crypto = require('crypto');
const zlib = require('zlib');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { Buffer } = require('buffer');

// --- CẤU HÌNH ---
const PORT = 3000;
const TEMP_DIR_NAME = 'temp_m3u8';
const TEMP_DIR_PATH = path.join(__dirname, '..', TEMP_DIR_NAME);
const FILE_EXPIRATION_MS = 12 * 60 * 60 * 1000;
const BASE_URL = `http://localhost:${PORT}`;

// --- TẠO THƯ MỤC TẠM ---
if (!fs.existsSync(TEMP_DIR_PATH)) {
    try {
        fs.mkdirSync(TEMP_DIR_PATH);
        console.log(`[AnimeVietsub] Đã tự động tạo thư mục tạm: ${TEMP_DIR_PATH}`);
    } catch (err) {
        console.error(`[AnimeVietsub] Lỗi nghiêm trọng khi tạo thư mục tạm: ${err}`);
        process.exit(1);
    }
} else {
     console.log(`[AnimeVietsub] Thư mục tạm đã tồn tại: ${TEMP_DIR_PATH}`);
}

// --- KHÓA VÀ HÀM GIẢI MÃ ---
const key_string_b64 = "ZG1fdGhhbmdfc3VjX3ZhdF9nZXRfbGlua19hbl9kYnQ=";
let aes_key_bytes = null;

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

function decryptAndDecompress(encrypted_data_string_b64) {
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
        const m3u8_content_raw = decompressed_bytes.toString('utf8'); // Dữ liệu gốc sau giải nén
        return m3u8_content_raw;
    } catch (error) {
        console.error("\n[AnimeVietsub] Lỗi giải mã/giải nén:", error.message);
        console.error("[AnimeVietsub] Dữ liệu đầu vào (50 ký tự đầu):", cleaned_encdata_b64.substring(0, 50) + "...");
        throw new Error(`Giải mã/Giải nén thất bại: ${error.message}`);
    }
}

// --- HÀM XỬ LÝ REQUEST ---
const requestHandler = (req, res) => {
    if (req.method === 'POST' && req.url === '/decrypt') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => { // Chuyển thành async để dùng await với writeFile
            console.log(`\n[AnimeVietsub] Nhận POST /decrypt lúc ${new Date().toISOString()}`);
            const encryptedDataString = body.trim();
            if (!encryptedDataString) {
                 console.error('[AnimeVietsub] Lỗi: Request body trống.');
                return res.status(400).type('text/plain; charset=utf-8').send('Lỗi: Request body trống.');
            }
            console.log(`[AnimeVietsub] Dữ liệu nhận được (50 ký tự đầu): ${encryptedDataString.substring(0, 50)}...`);

            try {
                // 1. Giải mã và giải nén
                let m3u8Content = decryptAndDecompress(encryptedDataString);

                // 2. Xử lý chuỗi M3U8
                console.log('[AnimeVietsub] Đang xử lý nội dung M3U8...');
                //   a. Xóa dấu " ở đầu và cuối (sau khi đã trim khoảng trắng)
                m3u8Content = m3u8Content.trim().replace(/^"|"$/g, '');
                //   b. Thay thế ký tự '\n' thành xuống dòng thật
                m3u8Content = m3u8Content.replace(/\\n/g, '\n');
                console.log('[AnimeVietsub] Đã xử lý xong nội dung M3U8.');

                // 3. Lưu vào file
                const randomFilename = `${crypto.randomBytes(16).toString('hex')}.m3u8`;
                const filePath = path.join(TEMP_DIR_PATH, randomFilename);
                const requestBaseUrl = `${req.protocol}://${req.get('host')}`;
                const publicUrl = `${requestBaseUrl}/animevietsub/files/${randomFilename}`; // Đảm bảo có prefix /animevietsub

                await fsp.writeFile(filePath, m3u8Content, 'utf8');
                console.log(`[AnimeVietsub] Đã lưu file xử lý vào: ${filePath}`);
                console.log(`[AnimeVietsub] URL trả về: ${publicUrl}`);

                // 4. Lên lịch xóa file
                setTimeout(() => {
                    fsp.unlink(filePath)
                        .then(() => console.log(`[AnimeVietsub] Đã tự động xóa file hết hạn: ${filePath}`))
                        .catch(unlinkErr => console.error(`[AnimeVietsub] Lỗi khi tự động xóa file ${filePath}:`, unlinkErr));
                }, FILE_EXPIRATION_MS);

                // 5. Trả về URL
                res.status(200).type('text/plain; charset=utf-8').send(publicUrl);

            } catch (error) {
                console.error("[AnimeVietsub] Lỗi xử lý:", error.message);
                res.status(500).type('text/plain; charset=utf-8').send(`Lỗi Server Nội Bộ: ${error.message}`);
            }
        });
         req.on('error', (err) => {
          console.error('[AnimeVietsub] Lỗi request:', err);
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Lỗi Server Nội Bộ khi xử lý request.');
        });

    } else if (req.method === 'GET' && req.url.startsWith('/files/')) {
        // ... (Phần xử lý GET /files không đổi) ...
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
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Endpoint không hợp lệ. Sử dụng POST /decrypt hoặc GET /files/<filename>.m3u8');
    }
};

// --- TẠO VÀ KHỞI ĐỘNG HTTP SERVER ---
const server = http.createServer(requestHandler);

server.listen(PORT, () => {
    console.log(`Server giải mã đang lắng nghe trên cổng ${PORT}`);
    console.log(`Thư mục lưu file tạm: ${TEMP_DIR_PATH}`);
    console.log(`URL cơ sở để truy cập file: ${BASE_URL}/files/`);
    console.log('--------------------------------------------------');
});

// Gắn router vào ứng dụng Express chính (Phần này nằm trong file app.js của bạn)
// const animevietsubRoutes = require('./routes/animevietsub'); // Đảm bảo đường dẫn đúng
// app.use('/animevietsub', animevietsubRoutes);
