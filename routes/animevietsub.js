import express from 'express';
import crypto from 'crypto'; // Dùng import thay cho require
import zlib from 'zlib';
import { Buffer } from 'buffer';
import NodeCache from 'node-cache';
import { gotScraping } from 'got-scraping';

const router = express.Router();

// --- CẤU HÌNH ---
const M3U8_CACHE_TTL_SECONDS = 12 * 60 * 60; // 12 giờ

// --- KHỞI TẠO CACHE ---
const m3u8Cache = new NodeCache({
    stdTTL: M3U8_CACHE_TTL_SECONDS,
    checkperiod: 600,
    useClones: false
});
console.log('[AnimeVietsub] M3U8 In-memory Cache đã được khởi tạo.');

// ... (Toàn bộ các hàm calculateAesKey, decryptAndDecompress giữ nguyên) ...
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
        } catch (e) {
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

// ... (route /decrypt và /m3u8/:cacheKey giữ nguyên) ...
router.post('/decrypt', async (req, res) => {
    const encryptedDataString = req.body;

    if (typeof encryptedDataString !== 'string' || !encryptedDataString) {
        console.error('[AnimeVietsub] Lỗi: Request body trống hoặc không phải dạng text.');
        return res.status(400).type('text/plain; charset=utf-8').send('Lỗi: Request body trống.');
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
                // URL segment giờ sẽ trỏ đến proxy nội bộ sử dụng got-scraping
                const selfProxiedUrl = `${requestScheme}://${requestHost}/animevietsub/segment_proxy?targetUrl=${encodeURIComponent(originalSegmentUrl)}&targetReferer=${encodeURIComponent(initialReferer)}`;
                return selfProxiedUrl;
            }
            return line;
        });
        m3u8Content = processedLines.join('\n');

        const cacheKey = `${crypto.randomBytes(16).toString('hex')}.m3u8`;
        m3u8Cache.set(cacheKey, m3u8Content);

        const publicM3u8Url = `${requestScheme}://${requestHost}/animevietsub/m3u8/${cacheKey}`;
        res.status(200).type('text/plain; charset=utf-8').send(publicM3u8Url);

    } catch (error) {
        console.error("[AnimeVietsub] Lỗi xử lý chính tại /decrypt:", error.stack);
        res.status(500).type('text/plain; charset=utf-8').send(`Lỗi Server: ${error.message}`);
    }
});

router.get('/m3u8/:cacheKey', (req, res) => {
    const { cacheKey } = req.params;
    if (!/^[a-f0-9]{32}\.m3u8$/.test(cacheKey)) {
        return res.status(400).send('Bad request: Invalid key format.');
    }

    const m3u8Content = m3u8Cache.get(cacheKey);
    if (m3u8Content) {
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.status(200).send(m3u8Content);
    } else {
        res.status(404).send('M3U8 not found or expired.');
    }
});


// --- THAY ĐỔI LỚN: /segment_proxy sử dụng got-scraping cho hiệu năng cao ---
router.get('/segment_proxy', async (req, res) => {
    const { targetUrl, targetReferer } = req.query;

    if (!targetUrl) {
        return res.status(400).send('Bad Request: targetUrl is required.');
    }

    try {
        const response = await gotScraping({
            url: targetUrl,
            responseType: 'buffer', // Yêu cầu nhận dữ liệu dạng buffer
            headerGeneratorOptions: {
                // Tự động tạo các header giống trình duyệt
                browsers: [{ name: 'chrome' }],
                operatingSystems: ['windows', 'linux']
            },
            headers: {
                // Ghi đè các header cần thiết
                'referer': targetReferer || '',
                'accept': '*/*',
                'user-agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
            },
            timeout: { request: 15000 }, // timeout 15 giây
            retry: { limit: 2 } // Thử lại 2 lần nếu thất bại
        });

        // Chuyển tiếp các header quan trọng từ response nhận được
        res.setHeader('Content-Type', response.headers['content-type'] || 'video/mp2t');
        res.setHeader('Content-Length', response.headers['content-length'] || response.rawBody.length);
        if(response.headers['accept-ranges']) {
            res.setHeader('Accept-Ranges', response.headers['accept-ranges']);
        }
        if(response.headers['content-range']) {
            res.setHeader('Content-Range', response.headers['content-range']);
        }

        res.status(response.statusCode).send(response.rawBody);

    } catch (error) {
        console.error(`[GotScraping] Lỗi khi lấy segment ${targetUrl}: ${error.message}`);
        const statusCode = error.response ? error.response.statusCode : 502;
        res.status(statusCode).send(`Bad Gateway: Lỗi khi proxy segment.`);
    }
});

export default router;
