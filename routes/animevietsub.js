const express = require('express');
const crypto = require('crypto');
const zlib = require('zlib');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { Buffer } = require('buffer');
const axios = require('axios'); // <<< THÊM DÒNG NÀY

const router = express.Router();

// --- CẤU HÌNH ---
const TEMP_DIR_NAME = 'temp_m3u8';
const TEMP_DIR_PATH = path.join(__dirname, '..', TEMP_DIR_NAME);
const FILE_EXPIRATION_MS = 12 * 60 * 60 * 1000; // 12 giờ
const PROXY_URL_BASE = 'https://prxclf.013666.xyz/'; // URL proxy của bạn

// --- TỰ ĐỘNG TẠO THƯ MỤC TẠM ---
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

// Khóa gốc (Base64 encoded)
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

router.use('/decrypt', express.text({ type: '*/*' }));

// Route POST để giải mã và tạo M3U8 với link segment trỏ về server này
router.post('/decrypt', async (req, res) => {
    console.log(`\n[AnimeVietsub] Nhận POST /decrypt lúc ${new Date().toISOString()}`);
    const encryptedDataString = req.body;

    if (typeof encryptedDataString !== 'string' || !encryptedDataString) {
        console.error('[AnimeVietsub] Lỗi: Request body trống hoặc không phải dạng text.');
        return res.status(400).type('text/plain; charset=utf-8').send('Lỗi: Request body trống hoặc không phải dạng text.');
    }
    console.log(`[AnimeVietsub] Dữ liệu nhận được (50 ký tự đầu): ${encryptedDataString.substring(0, 50)}...`);

    const apiKey = process.env.PROXY_API_KEY; // Vẫn cần API key này cho server gọi đi
    if (!apiKey) {
        console.error('[AnimeVietsub] Lỗi nghiêm trọng: PROXY_API_KEY chưa được cấu hình trong biến môi trường.');
        return res.status(500).type('text/plain; charset=utf-8').send('Lỗi Server: Cấu hình proxy bị thiếu. Vui lòng liên hệ quản trị viên.');
    }

    try {
        let m3u8Content = decryptAndDecompress(encryptedDataString);
        const initialReferer = req.headers.referer || ''; // Referer từ request gốc của client
        const requestScheme = req.protocol;
        const requestHost = req.get('host');

        console.log(`[AnimeVietsub] Initial Referer for M3U8 generation: ${initialReferer}`);

        const lines = m3u8Content.split('\n');
        const processedLines = lines.map(line => {
            const trimmedLine = line.trim();
            if (trimmedLine && !trimmedLine.startsWith('#')) {
                const originalSegmentUrl = trimmedLine;
                // Tạo URL trỏ về endpoint /segment_proxy trên chính server này
                // Các tham số targetUrl và targetReferer sẽ được mã hóa để truyền qua query string
                const selfProxiedUrl = `${requestScheme}://${requestHost}/animevietsub/segment_proxy?targetUrl=${encodeURIComponent(originalSegmentUrl)}&targetReferer=${encodeURIComponent(initialReferer)}`;
                // console.log(`[AnimeVietsub] M3U8 Segment: ${originalSegmentUrl} -> Self-Proxied: ${selfProxiedUrl.substring(0,150)}...`);
                return selfProxiedUrl;
            }
            return line;
        });
        m3u8Content = processedLines.join('\n');
        console.log('[AnimeVietsub] Đã tạo M3U8 với các URL segment trỏ về server proxy nội bộ.');

        const randomFilename = `${crypto.randomBytes(16).toString('hex')}.m3u8`;
        const filePath = path.join(TEMP_DIR_PATH, randomFilename);
        const publicM3u8Url = `${requestScheme}://${requestHost}/animevietsub/files/${randomFilename}`;

        await fsp.writeFile(filePath, m3u8Content, 'utf8');
        console.log(`[AnimeVietsub] Đã lưu file M3U8 (self-proxied) vào: ${filePath}`);
        console.log(`[AnimeVietsub] URL M3U8 (self-proxied) trả về: ${publicM3u8Url}`);

        setTimeout(() => {
            fsp.unlink(filePath)
                .then(() => console.log(`[AnimeVietsub] Đã tự động xóa file M3U8 (self-proxied) hết hạn: ${filePath}`))
                .catch(unlinkErr => console.error(`[AnimeVietsub] Lỗi khi tự động xóa file M3U8 (self-proxied) ${filePath}:`, unlinkErr));
        }, FILE_EXPIRATION_MS);

        res.status(200).type('text/plain; charset=utf-8').send(publicM3u8Url);

    } catch (error) {
        console.error("[AnimeVietsub] Lỗi xử lý chính tại /decrypt:", error.message, error.stack);
        res.status(500).type('text/plain; charset=utf-8').send(`Lỗi Server Nội Bộ: ${error.message}`);
    }
});

// Route GET để phục vụ file M3U8 (đã được xử lý ở /decrypt)
router.get('/files/:filename', async (req, res) => {
    // ... (Giữ nguyên như cũ)
    const requestedFilename = path.basename(req.params.filename || '');
    const filePath = path.join(TEMP_DIR_PATH, requestedFilename);
    console.log(`\n[AnimeVietsub] Nhận GET /files/${requestedFilename} lúc ${new Date().toISOString()}`);

    if (!/^[a-f0-9]{32}\.m3u8$/.test(requestedFilename)) {
        console.warn(`[AnimeVietsub] Tên file M3U8 không hợp lệ: ${requestedFilename}`);
        return res.status(400).type('text/plain; charset=utf-8').send('Bad request: Invalid filename format.');
    }

    try {
        await fsp.access(filePath, fs.constants.R_OK);
        console.log(`[AnimeVietsub] Đang phục vụ file M3U8: ${filePath}`);
        res.status(200).sendFile(filePath, {
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
                console.log(`[AnimeVietsub] Đã gửi xong file M3U8: ${filePath}`);
            }
        });
    } catch (error) {
        console.warn(`[AnimeVietsub] File M3U8 không tồn tại hoặc không đọc được: ${filePath}`);
        res.status(404).type('text/plain; charset=utf-8').send('File M3U8 not found or expired.');
    }
});


// --- ENDPOINT MỚI: Proxy cho các segment video ---
router.get('/segment_proxy', async (req, res) => {
    const { targetUrl, targetReferer } = req.query; // Express tự động decodeURIComponent các query params

    if (!targetUrl) {
        console.warn('[AnimeVietsub SegmentProxy] Yêu cầu thiếu targetUrl.');
        return res.status(400).send('Bad Request: targetUrl is required.');
    }
    // targetReferer có thể rỗng nếu request gốc không có referer

    const apiKey = process.env.PROXY_API_KEY;
    if (!apiKey) {
        console.error('[AnimeVietsub SegmentProxy] Lỗi: PROXY_API_KEY chưa được cấu hình.');
        return res.status(500).send('Server Configuration Error: Proxy API key missing.');
    }

    // Tạo URL đầy đủ để gọi đến proxy prxclf.013666.xyz
    // targetUrl và targetReferer đã được decode bởi Express, cần encode lại cho URL mới
    const finalExternalProxyUrl = `${PROXY_URL_BASE}?url=${encodeURIComponent(targetUrl)}&referer=${encodeURIComponent(targetReferer || '')}&auth_token=${apiKey}`;
    
    console.log(`[AnimeVietsub SegmentProxy] Đang proxy segment: ${targetUrl} (Referer: ${targetReferer || 'N/A'})`);
    // console.log(`[AnimeVietsub SegmentProxy] Gọi đến external proxy: ${finalExternalProxyUrl.substring(0,150)}...`);

    try {
        const proxyResponse = await axios({
            method: 'get',
            url: finalExternalProxyUrl,
            responseType: 'stream',
            headers: {
                'User-Agent': req.headers['user-agent'] || 'AnimeVietsubInternalProxy/1.0', // Chuyển tiếp User-Agent của client
                // Cân nhắc chuyển tiếp thêm các header khác nếu cần, ví dụ: Range
                ...(req.headers.range && { 'Range': req.headers.range })
            },
            timeout: 30000 // 30 giây timeout
        });

        // Chuyển tiếp các header quan trọng từ phản hồi của external proxy về client
        const headersToPipe = ['content-type', 'content-length', 'last-modified', 'etag', 'cache-control', 'expires', 'accept-ranges', 'content-disposition', 'content-range'];
        headersToPipe.forEach(headerName => {
            if (proxyResponse.headers[headerName]) {
                res.setHeader(headerName, proxyResponse.headers[headerName]);
            }
        });
        
        res.status(proxyResponse.status); // Đặt HTTP status của chúng ta giống như của external proxy
        proxyResponse.data.pipe(res); // Stream dữ liệu video về client

        proxyResponse.data.on('error', (streamErr) => {
            console.error('[AnimeVietsub SegmentProxy] Lỗi stream từ external proxy:', streamErr);
            if (!res.headersSent) {
                res.status(502).send('Bad Gateway: Lỗi stream từ upstream proxy.');
            }
            res.end(); // Đảm bảo kết thúc response
        });
        proxyResponse.data.on('end', () => {
            res.end(); // Đảm bảo kết thúc response khi stream thành công
        });

    } catch (error) {
        console.error('[AnimeVietsub SegmentProxy] Lỗi khi gọi external proxy hoặc stream:', error.message);
        if (error.response) { // Lỗi từ phía external proxy (ví dụ: 4xx, 5xx)
            console.error(`[AnimeVietsub SegmentProxy] External Proxy Error: Status ${error.response.status}`);
            // Cố gắng đọc và log error body từ external proxy nếu là stream
            let errorBody = 'Could not read error body from stream.';
            if (error.response.data && typeof error.response.data.read === 'function') {
                 // error.response.data is a stream
                try {
                    const chunks = [];
                    for await (const chunk of error.response.data) {
                        chunks.push(chunk);
                    }
                    errorBody = Buffer.concat(chunks).toString();
                } catch (e) {
                    // Ignore
                }
            } else if (error.response.data) {
                errorBody = JSON.stringify(error.response.data);
            }
            console.error(`[AnimeVietsub SegmentProxy] External Proxy Error Body: ${errorBody}`);

            if (!res.headersSent) {
                // Gửi lại status và một phần thông báo lỗi (nếu có và an toàn)
                res.status(error.response.status).send(`Error from upstream proxy: ${error.response.status}`);
            } else {
                 res.end();
            }
        } else if (error.request) { // Request đã được gửi nhưng không nhận được phản hồi
            console.error('[AnimeVietsub SegmentProxy] External Proxy: No response received.');
            if (!res.headersSent) {
                res.status(504).send('Gateway Timeout: No response from upstream proxy.');
            } else {
                 res.end();
            }
        } else { // Lỗi khác (ví dụ: lỗi cấu hình request axios)
            if (!res.headersSent) {
                res.status(500).send('Internal Server Error while proxying segment.');
            } else {
                res.end();
            }
        }
    }
});

module.exports = router;
