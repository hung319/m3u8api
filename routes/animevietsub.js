const express = require('express');
const crypto = require('crypto');
const zlib = require('zlib');
const fs = require('fs'); // <<< KHÔI PHỤC LẠI
const fsp = fs.promises; // <<< KHÔI PHỤC LẠI
const path = require('path');
const { Buffer } = require('buffer');
const axios = require('axios');
// const NodeCache = require('node-cache'); // <<< BỎ ĐI

const router = express.Router();

// --- CẤU HÌNH ---
const TEMP_DIR_NAME = 'temp_m3u8'; // <<< KHÔI PHỤC LẠI
const TEMP_DIR_PATH = path.join(__dirname, '..', TEMP_DIR_NAME); // <<< KHÔI PHỤC LẠI
const FILE_EXPIRATION_MS = 12 * 60 * 60 * 1000; // 12 giờ
const PROXY_URL_BASE = 'https://prxclf.013666.xyz/';

// const m3u8Cache = new NodeCache(...); // <<< BỎ ĐI
// console.log('[AnimeVietsub] M3U8 In-memory Cache đã được khởi tạo.'); // <<< BỎ ĐI

// --- TỰ ĐỘNG TẠO THƯ MỤC TẠM ---
if (!fs.existsSync(TEMP_DIR_PATH)) { // <<< KHÔI PHỤC LẠI LOGIC NÀY
    try {
        fs.mkdirSync(TEMP_DIR_PATH, { recursive: true });
        console.log(`[AnimeVietsub] Đã tự động tạo thư mục tạm: ${TEMP_DIR_PATH}`);
    } catch (err) {
        console.error(`[AnimeVietsub] Lỗi nghiêm trọng khi tạo thư mục tạm tại ${TEMP_DIR_PATH}. Lỗi: ${err}`);
        process.exit(1);
    }
} else {
     console.log(`[AnimeVietsub] Thư mục tạm đã tồn tại: ${TEMP_DIR_PATH}`);
}

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

        m3u8_content_raw = m3u8_content_raw.trim().replace(/^"|"$/g, '');
        m3u8_content_raw = m3u8_content_raw.replace(/\\n/g, '\n');
        return m3u8_content_raw;
    } catch (error) {
        console.error("[AnimeVietsub] Lỗi giải mã/giải nén:", error.message);
        throw new Error(`Giải mã thất bại: ${error.message}`);
    }
}

router.use('/decrypt', express.text({ type: '*/*' }));

router.post('/decrypt', async (req, res) => {
    const encryptedDataString = req.body;

    if (typeof encryptedDataString !== 'string' || !encryptedDataString) {
        console.error('[AnimeVietsub] Lỗi: Request body trống hoặc không phải dạng text.');
        return res.status(400).type('text/plain; charset=utf-8').send('Lỗi: Request body trống hoặc không phải dạng text.');
    }

    const apiKey = process.env.PROXY_API_KEY;
    if (!apiKey) {
        console.error('[AnimeVietsub] Lỗi nghiêm trọng: PROXY_API_KEY chưa được cấu hình trong biến môi trường.');
        return res.status(500).type('text/plain; charset=utf-8').send('Lỗi Server: Cấu hình proxy bị thiếu.');
    }

    try {
        let m3u8Content = decryptAndDecompress(encryptedDataString);
        const initialReferer = req.headers.referer || '';
        const requestScheme = req.protocol;
        const requestHost = req.get('host');

        const lines = m3u8Content.split('\n');
        const processedLines = lines.map(line => {
            const trimmedLine = line.trim();
            if (trimmedLine && !trimmedLine.startsWith('#')) {
                const originalSegmentUrl = trimmedLine;
                const selfProxiedUrl = `${requestScheme}://${requestHost}/animevietsub/segment_proxy?targetUrl=${encodeURIComponent(originalSegmentUrl)}&targetReferer=${encodeURIComponent(initialReferer)}`;
                return selfProxiedUrl;
            }
            return line;
        });
        m3u8Content = processedLines.join('\n');

        const randomFilename = `${crypto.randomBytes(16).toString('hex')}.m3u8`;
        const filePath = path.join(TEMP_DIR_PATH, randomFilename); // <<< KHÔI PHỤC LẠI filePath
        const publicM3u8Url = `${requestScheme}://${requestHost}/animevietsub/files/${randomFilename}`;

        // Ghi file M3U8 ra đĩa
        await fsp.writeFile(filePath, m3u8Content, 'utf8'); // <<< KHÔI PHỤC LẠI việc ghi file
        // console.log(`[AnimeVietsub] Đã lưu M3U8 vào đĩa: ${filePath}`); // Giảm log

        // Tự động xóa file sau khi hết hạn
        setTimeout(() => { // <<< KHÔI PHỤC LẠI setTimeout để xóa file
            fsp.unlink(filePath)
                .then(() => { /* console.log(`[AnimeVietsub] Đã tự động xóa file M3U8 hết hạn: ${filePath}`); */ }) // Giảm log
                .catch(unlinkErr => console.error(`[AnimeVietsub] Lỗi khi tự động xóa file ${filePath}:`, unlinkErr));
        }, FILE_EXPIRATION_MS);

        res.status(200).type('text/plain; charset=utf-8').send(publicM3u8Url);

    } catch (error) {
        console.error("[AnimeVietsub] Lỗi xử lý chính tại /decrypt:", error.message, error.stack);
        res.status(500).type('text/plain; charset=utf-8').send(`Lỗi Server Nội Bộ: ${error.message}`);
    }
});

router.get('/files/:filename', async (req, res) => {
    const requestedFilename = path.basename(req.params.filename || '');
    const filePath = path.join(TEMP_DIR_PATH, requestedFilename); // <<< KHÔI PHỤC LẠI filePath

    if (!/^[a-f0-9]{32}\.m3u8$/.test(requestedFilename)) {
        console.warn(`[AnimeVietsub] Tên file M3U8 không hợp lệ (format): ${requestedFilename}`);
        return res.status(400).type('text/plain; charset=utf-8').send('Bad request: Invalid filename format.');
    }

    try {
        // Kiểm tra file tồn tại và có quyền đọc
        await fsp.access(filePath, fs.constants.R_OK); // <<< KHÔI PHỤC LẠI access check
        // console.log(`[AnimeVietsub] Phục vụ M3U8 từ đĩa: ${filePath}`); // Giảm log
        res.status(200).sendFile(filePath, { // <<< KHÔI PHỤC LẠI sendFile
            headers: {
                'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
                'Access-Control-Allow-Origin': '*'
            }
        }, (err) => {
            if (err) {
                console.error(`[AnimeVietsub] Lỗi khi gửi file M3U8 ${filePath}:`, err);
                if (!res.headersSent) {
                    res.status(err.status || 500).send('Lỗi khi gửi file M3U8.');
                }
            } else {
                // console.log(`[AnimeVietsub] Đã gửi xong file M3U8: ${filePath}`); // Giảm log
            }
        });
    } catch (error) {
        console.warn(`[AnimeVietsub] M3U8 không tìm thấy trên đĩa hoặc không đọc được: ${filePath}`);
        res.status(404).type('text/plain; charset=utf-8').send('File M3U8 not found or expired.');
    }
});

// Endpoint /segment_proxy giữ nguyên logic như trước (đã giảm log)
router.get('/segment_proxy', async (req, res) => {
    const { targetUrl, targetReferer } = req.query;

    if (!targetUrl) {
        console.warn('[AnimeVietsub SegmentProxy] Yêu cầu thiếu targetUrl.');
        return res.status(400).send('Bad Request: targetUrl is required.');
    }

    const apiKey = process.env.PROXY_API_KEY;
    if (!apiKey) {
        console.error('[AnimeVietsub SegmentProxy] Lỗi: PROXY_API_KEY chưa được cấu hình.');
        return res.status(500).send('Server Configuration Error: Proxy API key missing.');
    }

    const finalExternalProxyUrl = `${PROXY_URL_BASE}?url=${encodeURIComponent(targetUrl)}&referer=${encodeURIComponent(targetReferer || '')}&auth_token=${apiKey}`;
    
    try {
        const proxyResponse = await axios({
            method: 'get',
            url: finalExternalProxyUrl,
            responseType: 'stream',
            headers: {
                'User-Agent': req.headers['user-agent'] || 'AnimeVietsubInternalProxy/1.0',
                ...(req.headers.range && { 'Range': req.headers.range })
            },
            timeout: 30000
        });

        const headersToPipe = ['content-type', 'content-length', 'last-modified', 'etag', 'cache-control', 'expires', 'accept-ranges', 'content-disposition', 'content-range'];
        headersToPipe.forEach(headerName => {
            if (proxyResponse.headers[headerName]) {
                res.setHeader(headerName, proxyResponse.headers[headerName]);
            }
        });
        
        res.status(proxyResponse.status);
        proxyResponse.data.pipe(res);

        proxyResponse.data.on('error', (streamErr) => {
            console.error('[AnimeVietsub SegmentProxy] Lỗi stream từ external proxy:', streamErr.message);
            if (!res.headersSent) {
                res.status(502).send('Bad Gateway: Lỗi stream từ upstream proxy.');
            }
            res.end();
        });

    } catch (error) {
        console.error('[AnimeVietsub SegmentProxy] Lỗi khi gọi external proxy:', error.message);
        if (error.response) {
            console.error(`[AnimeVietsub SegmentProxy] External Proxy Error: Status ${error.response.status}`);
            if (!res.headersSent) {
                res.status(error.response.status || 502).send(`Error from upstream proxy: ${error.response.status}`);
            } else {
                 res.end();
            }
        } else if (error.request) {
            console.error('[AnimeVietsub SegmentProxy] External Proxy: No response received.');
            if (!res.headersSent) {
                res.status(504).send('Gateway Timeout: No response from upstream proxy.');
            } else {
                 res.end();
            }
        } else {
            if (!res.headersSent) {
                res.status(500).send('Internal Server Error while proxying segment.');
            } else {
                res.end();
            }
        }
    }
});

module.exports = router;
