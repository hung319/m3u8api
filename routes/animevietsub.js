const http = require('http');
const crypto = require('crypto');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const { Buffer } = require('buffer');

// --- CẤU HÌNH ---
const PORT = 3000; // Cổng server sẽ lắng nghe
const TEMP_DIR_NAME = 'temp_m3u8'; // Tên thư mục lưu file m3u8 tạm
const TEMP_DIR_PATH = path.join(__dirname, TEMP_DIR_NAME);
const FILE_EXPIRATION_MS = 12 * 60 * 60 * 1000; // 12 giờ tính bằng mili giây
const BASE_URL = `http://localhost:${PORT}`; // THAY localhost bằng IP/Domain nếu cần truy cập từ xa

// Tạo thư mục tạm nếu chưa tồn tại
if (!fs.existsSync(TEMP_DIR_PATH)) {
    try {
        fs.mkdirSync(TEMP_DIR_PATH);
        console.log(`Đã tạo thư mục tạm: ${TEMP_DIR_PATH}`);
    } catch (err) {
        console.error(`Lỗi khi tạo thư mục tạm: ${err}`);
        process.exit(1); // Thoát nếu không tạo được thư mục
    }
}

// Khóa gốc (Base64 encoded)
const key_string_b64 = "ZG1fdGhhbmdfc3VjX3ZhdF9nZXRfbGlua19hbl9kYnQ=";
let aes_key_bytes = null; // Sẽ được tính một lần khi server khởi động

// --- HÀM GIẢI MÃ ---
function decryptAndDecompress(encrypted_data_string_b64) {
    // Tính khóa AES một lần duy nhất nếu chưa có
    if (!aes_key_bytes) {
        try {
            const decoded_key_bytes = Buffer.from(key_string_b64, 'base64');
            const sha256Hasher = crypto.createHash('sha256');
            sha256Hasher.update(decoded_key_bytes);
            aes_key_bytes = sha256Hasher.digest();
            console.log('Khóa AES đã được tính toán sẵn sàng.');
        } catch(e) {
            console.error('Không thể tính toán khóa AES:', e);
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
        console.error("\nLỗi trong quá trình giải mã/giải nén:", error.message);
        console.error("Dữ liệu đầu vào (đã làm sạch, 50 ký tự đầu):", cleaned_encdata_b64.substring(0, 50) + "...");
        throw new Error(`Giải mã thất bại: ${error.message}`);
    }
}

// --- HÀM XỬ LÝ REQUEST ---
const requestHandler = (req, res) => {
    // Xử lý yêu cầu POST đến /decrypt
    if (req.method === 'POST' && req.url === '/decrypt') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            console.log(`\nNhận POST /decrypt lúc ${new Date().toISOString()}`);
            if (!body) {
                res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Lỗi: Không có dữ liệu trong body.');
                return;
            }

            try {
                const m3u8Content = decryptAndDecompress(body);
                const randomFilename = `${crypto.randomBytes(16).toString('hex')}.m3u8`;
                const filePath = path.join(TEMP_DIR_PATH, randomFilename);
                const publicUrl = `${BASE_URL}/files/${randomFilename}`; // URL trả về cho người dùng

                fs.writeFile(filePath, m3u8Content, 'utf8', (err) => {
                    if (err) {
                        console.error("Lỗi khi lưu file M3U8:", err);
                        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                        res.end('Lỗi Server: Không thể lưu file.');
                        return;
                    }

                    console.log(`Đã giải mã thành công, lưu vào: ${filePath}`);
                    console.log(`URL trả về: ${publicUrl}`);

                    // Lên lịch xóa file sau 12 giờ
                    setTimeout(() => {
                        fs.unlink(filePath, (unlinkErr) => {
                            if (unlinkErr) {
                                console.error(`Lỗi khi tự động xóa file ${filePath}:`, unlinkErr);
                            } else {
                                console.log(`Đã tự động xóa file hết hạn: ${filePath}`);
                            }
                        });
                    }, FILE_EXPIRATION_MS);

                    // Trả về URL cho người dùng
                    res.writeHead(200, {
                        'Content-Type': 'text/plain; charset=utf-8',
                        'Access-Control-Allow-Origin': '*'
                    });
                    res.end(publicUrl);
                });

            } catch (error) {
                console.error("Gửi phản hồi lỗi 500 do giải mã thất bại.");
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end(`Lỗi Server Nội Bộ: ${error.message}`);
            }
        });
        req.on('error', (err) => {
          console.error('Lỗi request:', err);
          res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Lỗi Server Nội Bộ khi xử lý request.');
        });

    // Xử lý yêu cầu GET đến /files/...
    } else if (req.method === 'GET' && req.url.startsWith('/files/')) {
        const requestedFilename = path.basename(req.url); // Lấy tên file, tránh directory traversal
        const filePath = path.join(TEMP_DIR_PATH, requestedFilename);

        console.log(`Nhận GET ${req.url} lúc ${new Date().toISOString()}, phục vụ file: ${filePath}`);

        // Kiểm tra xem file có tồn tại trong thư mục tạm không
        fs.access(filePath, fs.constants.R_OK, (err) => {
            if (err) {
                console.warn(`File không tồn tại hoặc không đọc được: ${filePath}`);
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('File not found or expired.');
                return;
            }

            // Phục vụ file
            res.writeHead(200, {
                'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
                'Access-Control-Allow-Origin': '*'
             });
            const readStream = fs.createReadStream(filePath);
            readStream.pipe(res);

            readStream.on('error', (streamErr) => {
                console.error(`Lỗi khi đọc file ${filePath}:`, streamErr);
                // Nếu stream lỗi, có thể header đã được gửi, không thể gửi 500
                // Chỉ có thể kết thúc response nếu nó chưa kết thúc
                if (!res.writableEnded) {
                     res.end();
                }
            });
        });

    } else {
        // Các đường dẫn hoặc phương thức khác
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
