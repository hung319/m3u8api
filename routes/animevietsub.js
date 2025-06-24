const express = require('express');
const crypto = require('crypto');
const zlib = require('zlib');
const { Buffer } = require('buffer');
const axios = require('axios');
const FormData = require('form-data'); // <<< THAY ĐỔI: Import form-data

// --- Bỏ hoàn toàn logic và import của node-cache ---
// const NodeCache = require('node-cache');
// const m3u8Cache = new NodeCache(...)

const router = express.Router();

// --- CẤU HÌNH ---
const PROXY_URL_BASE = 'https://prxclf.013666.xyz/';
const DPASTE_API_URL = 'https://dpaste.org/api/'; // <<< THAY ĐỔI: Thêm URL API của dpaste

const key_string_b64 = "ZG1fdGhhbmdfc3VjX3ZhdF9nZXRfbGlua19hbl9kYnQ=";
let aes_key_bytes = null;

// Hàm calculateAesKey không thay đổi
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

// Hàm decryptAndDecompress không thay đổi
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

// <<< THAY ĐỔI LỚN: Logic trong router.post('/decrypt')
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
        // Bước 1 & 2: Giải mã và xử lý M3U8 (giữ nguyên)
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

        // <<< THAY ĐỔI: Bước 3 - Upload nội dung M3U8 lên dpaste.org
        console.log('[AnimeVietsub] Đang upload M3U8 lên dpaste.org...');
        const form = new FormData();
        form.append('content', m3u8Content);
        form.append('syntax', 'text');
        form.append('expiry_days', '1');

        const dpasteResponse = await axios.post(DPASTE_API_URL, form, {
            headers: form.getHeaders(), // Quan trọng: axios cần header này để gửi form data
            timeout: 15000 // Thêm timeout cho request
        });

        const dpasteUrl = dpasteResponse.data.trim();
        if (!dpasteUrl.startsWith('https://dpaste.org/')) {
             throw new Error('Phản hồi từ dpaste.org không hợp lệ.');
        }

        const publicM3u8Url = `${dpasteUrl}/raw`; // Thêm /raw vào cuối
        
        console.log(`[AnimeVietsub] Đã upload thành công. URL: ${publicM3u8Url}`);

        // Bước 4: Gửi lại link raw cho người dùng
        res.status(200).type('text/plain; charset=utf-8').send(publicM3u8Url);

    } catch (error) {
        let errorMessage = `Lỗi Server Nội Bộ: ${error.message}`;
        if (error.isAxiosError) {
             console.error("[AnimeVietsub] Lỗi khi gọi đến dpaste.org:", error.message);
             errorMessage = "Lỗi: Không thể upload M3U8 lên dịch vụ bên ngoài.";
        } else {
             console.error("[AnimeVietsub] Lỗi xử lý chính tại /decrypt:", error.message, error.stack);
        }
        res.status(500).type('text/plain; charset=utf-8').send(errorMessage);
    }
});

// <<< THAY ĐỔI: Xóa hoàn toàn route GET /m3u8/:cacheKey vì không còn cần thiết
/*
router.get('/m3u8/:cacheKey', (req, res) => {
    // ...
});
*/

// Endpoint /segment_proxy giữ nguyên logic như trước
router.get('/segment_proxy', async (req, res) => {
    // ... (Toàn bộ code của segment_proxy không thay đổi)
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

    const finalExternalProxyUrl = `${PROXY_URL_BASE}?url=${encodeURIComponent(targetUrl)}&referer=${encodeURIComponent(targetReferer || '')}&key=${apiKey}`;
    
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
