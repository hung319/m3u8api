// File: ./routes/anime47.js
const express = require('express');
const router = express.Router();
const CryptoJS = require("crypto-js");
const axios = require('axios');
const url = require('url'); // Module 'url' của Node.js
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// --- Hằng số giải mã ---
const key = "caphedaklak"; // QUAN TRỌNG: Trong môi trường production, hãy bảo vệ key này cẩn thận!

// --- Đối tượng CryptoJSAesJson để xử lý format JSON đặc biệt ---
const CryptoJSAesJson = {
    stringify: function (cipherParams) {
        var jsonObj = { ct: cipherParams.ciphertext.toString(CryptoJS.enc.Base64) };
        if (cipherParams.iv) { jsonObj.iv = cipherParams.iv.toString(); }
        if (cipherParams.salt) { jsonObj.s = cipherParams.salt.toString(); }
        return JSON.stringify(jsonObj);
    },
    parse: function (jsonStr) {
        try {
            var jsonObj = JSON.parse(jsonStr);
            var cipherParams = CryptoJS.lib.CipherParams.create({
                ciphertext: CryptoJS.enc.Base64.parse(jsonObj.ct)
            });
            // IV và Salt phải là đối tượng WordArray của CryptoJS
            if (jsonObj.iv) { cipherParams.iv = CryptoJS.enc.Hex.parse(jsonObj.iv); }
            if (jsonObj.s) { cipherParams.salt = CryptoJS.enc.Hex.parse(jsonObj.s); }
            return cipherParams;
        } catch (e) {
            console.error("[ANIME47] Lỗi phân tích JSON trong CryptoJSAesJson.parse:", e);
            throw new Error("Dữ liệu đầu vào cho CryptoJSAesJson.parse không phải JSON hợp lệ.");
        }
    }
};

// --- Cấu hình cho việc lưu trữ, phục vụ và xóa file M3U8 ---
const M3U8_STORAGE_SUBDIR_NAME = 'generated_m3u8s';      // Thư mục con trong 'public' để lưu file
const M3U8_FILE_LIFETIME_MS = 12 * 60 * 60 * 1000;     // 12 giờ
const M3U8_STATIC_ROUTE_SEGMENT = '/files';             // Đường dẫn URL để phục vụ file tĩnh này (ví dụ: /anime47/files/filename.m3u8)
// Đường dẫn tuyệt đối đến thư mục lưu trữ file M3U8
const M3U8_FILESYSTEM_STORAGE_DIR = path.join(__dirname, '..', 'public', M3U8_STORAGE_SUBDIR_NAME);
const MAX_TIMEOUT_DELAY = 2147483647; // Giới hạn trên của setTimeout (khoảng 24.8 ngày)

// --- Tự phục vụ file tĩnh cho M3U8 ---
// Middleware này sẽ phục vụ các file từ M3U8_FILESYSTEM_STORAGE_DIR
// tại đường dẫn <router_base_path>/M3U8_STATIC_ROUTE_SEGMENT
router.use(M3U8_STATIC_ROUTE_SEGMENT, express.static(M3U8_FILESYSTEM_STORAGE_DIR, {
    maxAge: '1h', // Ví dụ: cache trình duyệt trong 1 giờ
}));
console.log(`[ANIME47] Sẵn sàng phục vụ file M3U8 tĩnh từ ${M3U8_FILESYSTEM_STORAGE_DIR} tại route <base_anime47_path>${M3U8_STATIC_ROUTE_SEGMENT}`);

// --- Logic xóa file và lên lịch xóa bằng setTimeout ---
async function deleteFile(filePath) {
    try {
        await fs.unlink(filePath);
        console.log(`[ANIME47][DELETE] Đã xóa file: ${filePath}`);
    } catch (err) {
        if (err.code === 'ENOENT') {
            // File không tìm thấy, có thể đã được xóa trước đó. Không cần log lỗi.
        } else {
            console.error(`[ANIME47][DELETE] Lỗi khi xóa file ${filePath}:`, err);
        }
    }
}

function scheduleDeletion(filePath, delayMs) {
    if (delayMs <= 0) {
        console.log(`[ANIME47][SCHED] File ${filePath} đã quá hạn hoặc đến hạn. Xóa ngay.`);
        deleteFile(filePath).catch(err => console.error(`[ANIME47][SCHED] Lỗi khi xóa file (quá hạn) ${filePath} ngay lập tức:`, err));
    } else {
        const effectiveDelay = Math.min(delayMs, MAX_TIMEOUT_DELAY);
        if (delayMs > MAX_TIMEOUT_DELAY) {
             console.warn(`[ANIME47][SCHED] Thời gian trì hoãn xóa file ${filePath} (${delayMs}ms) quá lớn, đã được giới hạn thành ${effectiveDelay}ms.`);
        }
        
        setTimeout(() => {
            console.log(`[ANIME47][SCHED-TIMER] Thời gian chờ của file ${filePath} đã hết. Thực hiện xóa.`);
            deleteFile(filePath).catch(err => console.error(`[ANIME47][SCHED-TIMER] Lỗi khi xóa file ${filePath} bằng timer:`, err));
        }, effectiveDelay);
        console.log(`[ANIME47][SCHED] Đã lên lịch xóa file ${filePath} sau khoảng ${Math.round(effectiveDelay / 1000 / 60)} phút.`);
    }
}

// --- Quét file cũ và lên lịch xóa khi server khởi động ---
async function performStartupScanAndScheduleDeletions() {
    console.log('[ANIME47][STARTUP_SCAN] Bắt đầu quét các file M3U8 cũ để lên lịch xóa...');
    try {
        // Đảm bảo thư mục lưu trữ tồn tại, nếu không thì tạo mới
        await fs.mkdir(M3U8_FILESYSTEM_STORAGE_DIR, { recursive: true });
        console.log(`[ANIME47][STARTUP_SCAN] Sử dụng thư mục lưu trữ: ${M3U8_FILESYSTEM_STORAGE_DIR}`);
    } catch (mkdirErr) {
        console.error(`[ANIME47][STARTUP_SCAN] Không thể tạo hoặc truy cập thư mục ${M3U8_FILESYSTEM_STORAGE_DIR}:`, mkdirErr);
        return; // Không thể tiếp tục nếu không có thư mục
    }

    try {
        const files = await fs.readdir(M3U8_FILESYSTEM_STORAGE_DIR);
        const now = Date.now();
        let scheduledCount = 0;
        let immediateDeleteCount = 0;

        if (files.length === 0) {
            console.log('[ANIME47][STARTUP_SCAN] Không có file nào trong thư mục để quét.');
        }

        for (const file of files) {
            if (file.endsWith('.m3u8')) { // Chỉ xử lý file .m3u8
                const filePath = path.join(M3U8_FILESYSTEM_STORAGE_DIR, file);
                try {
                    const stats = await fs.stat(filePath);
                    const fileAgeMs = now - stats.mtimeMs; // Tuổi của file (ms)
                    const remainingTimeMs = M3U8_FILE_LIFETIME_MS - fileAgeMs;

                    scheduleDeletion(filePath, remainingTimeMs);
                    if (remainingTimeMs <= 0) {
                        immediateDeleteCount++;
                    } else {
                        scheduledCount++;
                    }
                } catch (statErr) {
                    // Bỏ qua nếu file không còn tồn tại (ví dụ: đã bị xóa bởi tiến trình khác)
                    if (statErr.code !== 'ENOENT') {
                        console.error(`[ANIME47][STARTUP_SCAN] Lỗi khi lấy thông tin file ${filePath}:`, statErr);
                    }
                }
            }
        }
        console.log(`[ANIME47][STARTUP_SCAN] Quét hoàn tất. Xóa ngay: ${immediateDeleteCount} file. Lên lịch xóa thêm: ${scheduledCount} file.`);
    } catch (err) {
        console.error('[ANIME47][STARTUP_SCAN] Lỗi nghiêm trọng khi quét thư mục M3U8:', err);
    }
}

// Chạy quét khi module này được load (server khởi động)
performStartupScanAndScheduleDeletions().catch(err => {
    console.error('[ANIME47][CRITICAL_STARTUP_ERROR] Lỗi không xử lý được trong quá trình quét khởi động:', err);
});


// --- Route xử lý chính ---
router.get('/link/:base64data', async (req, res) => {
    const base64EncodedJson = req.params.base64data;
    console.log(`\n[ANIME47] --- Bắt đầu xử lý yêu cầu cho /link/${base64EncodedJson.substring(0, 30)}... ---`);

    if (!base64EncodedJson) {
        console.log("[ANIME47][LỖI] Thiếu dữ liệu Base64.");
        return res.status(400).json({ error: "Missing Base64 data in URL parameter." });
    }

    let masterPlaylistUrl; // Sẽ được dùng ở Bước 5
    let m3u8Content;       // Sẽ được dùng ở Bước 5

    try {
        // Bước 1: Giải mã Base64 -> chuỗi JSON
        let jsonStringFromBase64;
        try {
            jsonStringFromBase64 = Buffer.from(base64EncodedJson, 'base64').toString('utf8');
            console.log("[ANIME47][OK] Bước 1: Giải mã Base64 thành công.");
        } catch (bufferError) {
            console.error("[ANIME47][LỖI] Bước 1: Lỗi giải mã Base64:", bufferError);
            return res.status(400).json({ error: "Invalid Base64 data provided.", details: bufferError.message });
        }

        // Bước 2a: Parse chuỗi JSON bằng formatter để lấy đối tượng CipherParams
        let cipherParams;
        try {
            console.log("[ANIME47][...] Bước 2a: Đang parse input bằng formatter...");
            cipherParams = CryptoJSAesJson.parse(jsonStringFromBase64);
            console.log("[ANIME47][OK] Bước 2a: Parse input bằng formatter thành công.");
        } catch (formatParseError) {
            console.error("[ANIME47][LỖI] Bước 2a: Lỗi khi parse input bằng formatter:", formatParseError);
            return res.status(500).json({ error: `Failed to parse input using custom format: ${formatParseError.message}` });
        }

        // Bước 2b: Giải mã AES sử dụng đối tượng CipherParams và key
        console.log("[ANIME47][...] Bước 2b: Đang giải mã AES từ CipherParams...");
        const decryptedBytes = CryptoJS.AES.decrypt(cipherParams, key);
        const decryptedJsonString = decryptedBytes.toString(CryptoJS.enc.Utf8);

        if (!decryptedJsonString && decryptedBytes.sigBytes > 0) {
            console.error("[ANIME47][LỖI] Bước 2b: Giải mã AES thất bại (có thể sai key).");
            return res.status(500).json({ error: "AES decryption failed, please check key." });
        } else if (!decryptedJsonString) {
            console.warn("[ANIME47][LỖI] Bước 2b: Giải mã thành công nhưng kết quả rỗng.");
            return res.status(500).json({ error: "Decryption resulted in empty data. Check input." });
        }
        console.log(`[ANIME47][OK] Bước 2b: Giải mã AES thành công.`);

        // Bước 3: Parse JSON string (kết quả giải mã) -> Master Playlist URL (Link 1)
        try {
            masterPlaylistUrl = JSON.parse(decryptedJsonString);
            if (typeof masterPlaylistUrl !== 'string' || !masterPlaylistUrl.startsWith('http')) {
                throw new Error('Dữ liệu giải mã không phải là chuỗi URL hợp lệ.');
            }
            console.log(`[ANIME47][OK] Bước 3: Parse JSON thành công. Master Playlist URL: ${masterPlaylistUrl}`);
        } catch (parseError) {
            if (typeof decryptedJsonString === 'string' && decryptedJsonString.startsWith('http')) {
                masterPlaylistUrl = decryptedJsonString; // Sử dụng trực tiếp nếu là URL string
                console.warn(`[ANIME47][WARN] Bước 3: Không parse được JSON, dùng chuỗi giải mã gốc làm URL master: ${masterPlaylistUrl}`);
            } else {
                console.error("[ANIME47][LỖI] Bước 3: Dữ liệu giải mã không thể diễn giải thành URL:", parseError.message, "Decrypted string:", decryptedJsonString);
                return res.status(500).json({ error: "Decrypted data could not be interpreted as a valid URL." });
            }
        }

        // Bước 4: Fetch nội dung của Master Playlist URL
        try {
            console.log(`[ANIME47][...] Bước 4: Đang tải master playlist từ: ${masterPlaylistUrl}`);
            const response = await axios.get(masterPlaylistUrl, {
                timeout: 15000,
                headers: { // Các headers cần thiết để truy cập link
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36',
                    'Referer': new url.URL(masterPlaylistUrl).origin + '/' // Lấy origin làm Referer hoặc một giá trị phù hợp
                }
            });
            m3u8Content = response.data;
            if (typeof m3u8Content !== 'string') {
                console.error("[ANIME47][LỖI] Bước 4: Dữ liệu tải về không phải dạng chuỗi.", typeof m3u8Content);
                throw new Error('Response data from master playlist is not a string.');
            }
            if (!m3u8Content.includes('#EXTM3U')) {
                console.warn("[ANIME47][WARN] Bước 4: Dữ liệu tải về có vẻ không phải M3U8 (thiếu #EXTM3U).");
            }
            console.log("[ANIME47][OK] Bước 4: Đã tải xong nội dung M3U8 gốc.");
        } catch (fetchError) {
            console.error(`[ANIME47][LỖI] Bước 4: Lỗi khi tải master playlist (${masterPlaylistUrl}):`, fetchError.response?.status, fetchError.message);
            return res.status(500).json({
                error: `Failed to fetch master playlist content from ${masterPlaylistUrl}`,
                details: fetchError.message
            });
        }

        // Bước 5: Chỉnh sửa nội dung M3U8 - Đảm bảo tất cả URL là tuyệt đối dựa trên masterPlaylistUrl
        console.log("[ANIME47][...] Bước 5: Đang chỉnh sửa nội dung M3U8 (đảm bảo URL tuyệt đối)...");
        let modifiedM3u8Content;
        try {
            const lines = m3u8Content.split(/[\r\n]+/);
            modifiedM3u8Content = lines.map(line => {
                const trimmedLine = line.trim();

                if (!trimmedLine) return ""; 
                if (trimmedLine.startsWith('#EXTM3U')) return line; 
                if (trimmedLine.startsWith('#EXT-X-VERSION')) return line;
                
                if (trimmedLine.includes('URI="')) {
                    const uriMatch = trimmedLine.match(/URI="([^"]+)"/);
                    if (uriMatch && uriMatch[1]) {
                        const relativeUri = uriMatch[1];
                        if (relativeUri.startsWith('http://') || relativeUri.startsWith('https://') || relativeUri.startsWith('data:')) {
                            return line;
                        }
                        try {
                            const absoluteUri = new url.URL(relativeUri, masterPlaylistUrl).href;
                            return trimmedLine.replace(uriMatch[0], `URI="${absoluteUri}"`);
                        } catch (e) {
                            console.warn(`[ANIME47][WARN] Bước 5: Không thể phân giải URI "${relativeUri}" trong dòng: ${trimmedLine}. Lỗi: ${e.message}. Giữ nguyên.`);
                            return line;
                        }
                    }
                } else if (!trimmedLine.startsWith('#')) {
                    if (trimmedLine.startsWith('http://') || trimmedLine.startsWith('https://')) {
                        return line;
                    }
                    try {
                        const absoluteSegmentUrl = new url.URL(trimmedLine, masterPlaylistUrl).href;
                        return absoluteSegmentUrl;
                    } catch (e) {
                        console.warn(`[ANIME47][WARN] Bước 5: Không thể phân giải URL segment: "${trimmedLine}". Lỗi: ${e.message}. Giữ nguyên.`);
                        return line;
                    }
                }
                return line;
            }).filter(line => line !== null).join('\n'); // filter(line => line !== null) để loại bỏ dòng trống gây ra bởi map
            
            console.log("[ANIME47][OK] Bước 5: Đã chỉnh sửa nội dung M3U8 thành URL tuyệt đối.");
        } catch (modifyError) {
            console.error("[ANIME47][LỖI] Bước 5: Lỗi trong quá trình chỉnh sửa nội dung M3U8:", modifyError);
            return res.status(500).json({ error: "Failed to modify M3U8 content.", details: modifyError.message });
        }

        // Bước 6: Lưu M3U8 đã chỉnh sửa vào file, lên lịch xóa và tạo URL truy cập
        let fileUrl;
        console.log("[ANIME47][...] Bước 6: Đang lưu file M3U8 đã chỉnh sửa...");
        try {
            // Đảm bảo thư mục cha (public) và thư mục con tồn tại.
            // M3U8_FILESYSTEM_STORAGE_DIR đã được mkdir trong startup scan, nhưng kiểm tra lại không thừa.
            await fs.mkdir(M3U8_FILESYSTEM_STORAGE_DIR, { recursive: true });

            const filename = `${uuidv4()}.m3u8`;
            const filePath = path.join(M3U8_FILESYSTEM_STORAGE_DIR, filename);
            await fs.writeFile(filePath, modifiedM3u8Content);
            console.log(`[ANIME47][OK] Bước 6a: Đã lưu file M3U8 tại: ${filePath}`);

            // Lên lịch xóa file này sau M3U8_FILE_LIFETIME_MS
            scheduleDeletion(filePath, M3U8_FILE_LIFETIME_MS);

            // Tạo URL để client có thể truy cập file.
            // req.baseUrl sẽ là '/anime47' (hoặc bất cứ gì được mount trong index.js)
            fileUrl = `${req.protocol}://${req.get('host')}${req.baseUrl}${M3U8_STATIC_ROUTE_SEGMENT}/${filename}`;
            console.log(`[ANIME47][OK] Bước 6b: URL của file M3U8 đã tạo: ${fileUrl}`);

        } catch (saveError) {
            console.error("[ANIME47][LỖI] Bước 6: Lỗi khi lưu file M3U8 hoặc tạo URL:", saveError);
            return res.status(500).json({ error: "Failed to save M3U8 file or create its URL.", details: saveError.message });
        }

        // Bước 7: Gửi phản hồi JSON với URL của file M3U8 đã chỉnh sửa
        console.log("[ANIME47][OK] Bước 7: Gửi phản hồi JSON với URL của M3U8 đã chỉnh sửa.");
        res.status(200).json({ modifiedM3u8Url: fileUrl });

    } catch (error) { // Khối catch tổng quát cho toàn bộ request
        console.error(`[ANIME47][LỖI TỔNG QUÁT] Xử lý /link/${base64EncodedJson.substring(0,30)}... thất bại:`, error);
        res.status(500).json({ error: `Server error: ${error.message}`, details: error.stack });
    }
});

module.exports = router;
