const express = require('express');
const crypto = require('crypto');
const zlib = require('zlib');
// const fs = require('fs'); // fs và fsp không còn cần thiết cho việc lưu file M3U8 nữa
// const fsp = fs.promises;
const path = require('path'); // path vẫn có thể cần cho __dirname
const { Buffer } = require('buffer');
const axios = require('axios');
const NodeCache = require('node-cache'); // <<< THÊM DÒNG NÀY

const router = express.Router();

// --- CẤU HÌNH ---
// const TEMP_DIR_NAME = 'temp_m3u8'; // Không còn dùng thư mục tạm cho M3U8
// const TEMP_DIR_PATH = path.join(__dirname, '..', TEMP_DIR_NAME); // Không còn dùng
const FILE_EXPIRATION_MS = 12 * 60 * 60 * 1000; // 12 giờ
const PROXY_URL_BASE = 'https://prxclf.013666.xyz/';

// Khởi tạo cache cho M3U8
// stdTTL: thời gian sống mặc định của một cache item (tính bằng giây)
// checkperiod: chu kỳ kiểm tra và xóa các item hết hạn (tính bằng giây)
const m3u8Cache = new NodeCache({ stdTTL: FILE_EXPIRATION_MS / 1000, checkperiod: Math.floor(FILE_EXPIRATION_MS / 1000 * 0.2) });
console.log('[AnimeVietsub] M3U8 In-memory Cache đã được khởi tạo.');

// --- TỰ ĐỘNG TẠO THƯ MỤC TẠM --- (Phần này có thể không cần nữa nếu bạn không lưu file nào khác)
/*
if (!fs.existsSync(TEMP_DIR_PATH)) {
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
*/

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

        // console.log('[AnimeVietsub] Đang xử lý nội dung M3U8...'); // Giảm log
        m3u8_content_raw = m3u8_content_raw.trim().replace(/^"|"$/g, '');
        m3u8_content_raw = m3u8_content_raw.replace(/\\n/g, '\n');
        // console.log('[AnimeVietsub] Đã xử lý xong nội dung M3U8 ban đầu.'); // Giảm log
        return m3u8_content_raw;
    } catch (error) {
        console.error("[AnimeVietsub] Lỗi giải mã/giải nén:", error.message);
        // console.error("[AnimeVietsub] Dữ liệu đầu vào (50 ký tự đầu):", cleaned_encdata_b64.substring(0, 50) + "..."); // Giảm log lỗi chi tiết
        throw new Error(`Giải mã thất bại: ${error.message}`);
    }
}

router.use('/decrypt', express.text({ type: '*/*' }));

router.post('/decrypt', async (req, res) => {
    // console.log(`\n[AnimeVietsub] Nhận POST /decrypt lúc ${new Date().toISOString()}`); // Giảm log
    const encryptedDataString = req.body;

    if (typeof encryptedDataString !== 'string' || !encryptedDataString) {
        console.error('[AnimeVietsub] Lỗi: Request body trống hoặc không phải dạng text.');
        return res.status(400).type('text/plain; charset=utf-8').send('Lỗi: Request body trống hoặc không phải dạng text.');
    }
    // console.log(`[AnimeVietsub] Dữ liệu nhận được (50 ký tự đầu): ${encryptedDataString.substring(0, 50)}...`); // Giảm log

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

        // console.log(`[AnimeVietsub] Initial Referer for M3U8 generation: ${initialReferer}`); // Giảm log

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
        // console.log('[AnimeVietsub] Đã tạo M3U8 với các URL segment trỏ về server proxy nội bộ.'); // Giảm log

        const randomFilename = `${crypto.randomBytes(16).toString('hex')}.m3u8`;
        const publicM3u8Url = `${requestScheme}://${requestHost}/animevietsub/files/${randomFilename}`;

        // Lưu vào cache thay vì ghi ra file
        m3u8Cache.set(randomFilename, m3u8Content);
        // console.log(`[AnimeVietsub] Đã lưu M3U8 vào cache: ${randomFilename}`); // Giảm log
        // console.log(`[AnimeVietsub] URL M3U8 (self-proxied) trả về: ${publicM3u8Url}`); // Giảm log

        res.status(200).type('text/plain; charset=utf-8').send(publicM3u8Url);

    } catch (error) {
        console.error("[AnimeVietsub] Lỗi xử lý chính tại /decrypt:", error.message, error.stack); // Giữ stack để debug
        res.status(500).type('text/plain; charset=utf-8').send(`Lỗi Server Nội Bộ: ${error.message}`);
    }
});

router.get('/files/:filename', async (req, res) => {
    const requestedFilename = path.basename(req.params.filename || '');
    // console.log(`\n[AnimeVietsub] Nhận GET /files/${requestedFilename} lúc ${new Date().toISOString()}`); // Giảm log

    if (!/^[a-f0-9]{32}\.m3u8$/.test(requestedFilename)) {
        console.warn(`[AnimeVietsub] Tên file M3U8 không hợp lệ (format): ${requestedFilename}`);
        return res.status(400).type('text/plain; charset=utf-8').send('Bad request: Invalid filename format.');
    }

    // Lấy từ cache
    const cachedM3u8Content = m3u8Cache.get(requestedFilename);

    if (cachedM3u8Content) {
        // console.log(`[AnimeVietsub] Phục vụ M3U8 từ cache: ${requestedFilename}`); // Giảm log
        res.header('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8')
           .header('Access-Control-Allow-Origin', '*')
           .status(200)
           .send(cachedM3u8Content);
    } else {
        console.warn(`[AnimeVietsub] M3U8 không tìm thấy trong cache hoặc đã hết hạn: ${requestedFilename}`);
        res.status(404).type('text/plain; charset=utf-8').send('File M3U8 not found or expired.');
    }
});

router.get('/segment_proxy', async (req, res) => { // Đã sửa đường dẫn này ở lần trước
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
    
    // console.log(`[AnimeVietsub SegmentProxy] Đang proxy segment: ${targetUrl} (Referer: ${targetReferer || 'N/A'})`); // Log này rất nhiều, nên bỏ
    
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
        // Không cần res.end() ở 'end' event của proxyResponse.data vì pipe sẽ tự xử lý việc kết thúc response khi nguồn stream kết thúc.
        // Thêm nó có thể gây lỗi "write after end".

    } catch (error) {
        console.error('[AnimeVietsub SegmentProxy] Lỗi khi gọi external proxy:', error.message);
        if (error.response) {
            console.error(`[AnimeVietsub SegmentProxy] External Proxy Error: Status ${error.response.status}`);
            // Không cố đọc error.response.data nếu là stream trong trường hợp này để tránh phức tạp thêm,
            // status code và message thường đủ cho việc debug lỗi từ external proxy.
            // Nếu cần debug sâu hơn, bạn có thể thêm lại logic đọc stream lỗi.
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
