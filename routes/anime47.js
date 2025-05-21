// File: ./routes/anime47.js
const express = require('express');
const router = express.Router();
const CryptoJS = require("crypto-js");
const axios = require('axios');
const url = require('url');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// --- Hằng số giải mã (giữ nguyên) ---
const key = "caphedaklak";

const CryptoJSAesJson = { /* ... (giữ nguyên như trước) ... */ };
// --- Kết thúc hằng số giải mã ---

// --- Cấu hình ---
const M3U8_BASE_URL_TO_PREPEND = "https://pl.vlogphim.net";
const M3U8_STORAGE_SUBDIR_NAME = 'generated_m3u8s';
const M3U8_FILE_LIFETIME_MS = 12 * 60 * 60 * 1000; // 12 giờ
const M3U8_STATIC_ROUTE_SEGMENT = '/files';
const M3U8_FILESYSTEM_STORAGE_DIR = path.join(__dirname, '..', 'public', M3U8_STORAGE_SUBDIR_NAME);
const MAX_TIMEOUT_DELAY = 2147483647; // Khoảng 24.8 ngày, giới hạn của setTimeout

// --- Tự phục vụ file tĩnh cho M3U8 (giữ nguyên) ---
router.use(M3U8_STATIC_ROUTE_SEGMENT, express.static(M3U8_FILESYSTEM_STORAGE_DIR, { maxAge: '1h' }));
console.log(`[ANIME47] Phục vụ file M3U8 tĩnh từ ${M3U8_FILESYSTEM_STORAGE_DIR} tại route ${M3U8_STATIC_ROUTE_SEGMENT}`);

// --- Logic xóa file và lên lịch xóa ---
async function deleteFile(filePath) {
    try {
        await fs.unlink(filePath);
        console.log(`[ANIME47][DELETE] Đã xóa file: ${filePath}`);
    } catch (err) {
        if (err.code === 'ENOENT') {
            // File không tìm thấy, có thể đã được xóa bởi một tiến trình khác hoặc lần chạy trước
            // console.log(`[ANIME47][DELETE] File không tìm thấy khi xóa: ${filePath}`);
        } else {
            console.error(`[ANIME47][DELETE] Lỗi khi xóa file ${filePath}:`, err);
        }
    }
}

function scheduleDeletion(filePath, delayMs) {
    if (delayMs <= 0) {
        console.log(`[ANIME47][SCHED] File ${filePath} đã quá hạn hoặc đến hạn. Xóa ngay.`);
        deleteFile(filePath).catch(err => console.error(`[ANIME47][SCHED] Lỗi khi xóa file ngay lập tức ${filePath}:`, err));
    } else {
        const effectiveDelay = Math.min(delayMs, MAX_TIMEOUT_DELAY);
        if (delayMs > MAX_TIMEOUT_DELAY) {
             console.warn(`[ANIME47][SCHED] Thời gian trì hoãn xóa file ${filePath} (${delayMs}ms) quá lớn, đặt thành ${effectiveDelay}ms.`);
        }
        
        setTimeout(() => {
            console.log(`[ANIME47][SCHED] Timer: Thời gian chờ của file ${filePath} đã hết. Thực hiện xóa.`);
            deleteFile(filePath).catch(err => console.error(`[ANIME47][SCHED] Lỗi khi xóa file bằng timer ${filePath}:`, err));
        }, effectiveDelay);
        console.log(`[ANIME47][SCHED] Đã lên lịch xóa file ${filePath} sau khoảng ${Math.round(effectiveDelay / 1000 / 60)} phút.`);
    }
}

// --- Quét file cũ khi server khởi động ---
async function performStartupScanAndScheduleDeletions() {
    console.log('[ANIME47][STARTUP_SCAN] Bắt đầu quét các file M3U8 cũ...');
    try {
        // Đảm bảo thư mục tồn tại, nếu không thì tạo mới
        await fs.mkdir(M3U8_FILESYSTEM_STORAGE_DIR, { recursive: true });
        console.log(`[ANIME47][STARTUP_SCAN] Thư mục lưu trữ: ${M3U8_FILESYSTEM_STORAGE_DIR}`);
    } catch (mkdirErr) {
        console.error(`[ANIME47][STARTUP_SCAN] Không thể tạo hoặc truy cập thư mục ${M3U8_FILESYSTEM_STORAGE_DIR}:`, mkdirErr);
        return; // Không thể tiếp tục nếu không có thư mục lưu trữ
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
            if (file.endsWith('.m3u8')) {
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
                    if (statErr.code !== 'ENOENT') { // Bỏ qua nếu file không còn tồn tại
                        console.error(`[ANIME47][STARTUP_SCAN] Lỗi khi lấy thông tin file ${filePath}:`, statErr);
                    }
                }
            }
        }
        console.log(`[ANIME47][STARTUP_SCAN] Quét hoàn tất. Xóa ngay: ${immediateDeleteCount} file. Lên lịch xóa thêm: ${scheduledCount} file.`);
    } catch (err) {
        // Lỗi này có thể xảy ra nếu readdir thất bại sau khi mkdir thành công (hiếm)
        console.error('[ANIME47][STARTUP_SCAN] Lỗi nghiêm trọng khi quét file M3U8:', err);
    }
}

// Chạy quét khi module này được load (server khởi động)
performStartupScanAndScheduleDeletions().catch(err => {
    console.error('[ANIME47][CRITICAL_STARTUP_ERROR] Lỗi không xử lý được trong quá trình quét khởi động:', err);
});


// --- Route xử lý chính (logic giải mã, tải file, v.v. giữ nguyên như trước) ---
router.get('/link/:base64data', async (req, res) => {
    const base64EncodedJson = req.params.base64data;
    console.log(`\n[ANIME47] --- Bắt đầu xử lý yêu cầu cho /link/${base64EncodedJson.substring(0, 30)}... ---`);

    // ... (Toàn bộ các bước 1 đến 4: giải mã, lấy masterPlaylistUrl, tải m3u8Content giữ nguyên) ...
    // Copy từ phiên bản trước của bạn
        // Bước 1: Giải mã Base64 -> chuỗi JSON
        let jsonStringFromBase64;
        try {
            jsonStringFromBase64 = Buffer.from(base64EncodedJson, 'base64').toString('utf8');
            console.log("[ANIME47][OK] Bước 1: Giải mã Base64 thành công.");
        } catch (bufferError) { /* ... error handling ... */ return res.status(400).json({ error: "Invalid Base64 data provided." });}

        // Bước 2a: Parse chuỗi JSON bằng formatter
        let cipherParams;
        try {
            cipherParams = CryptoJSAesJson.parse(jsonStringFromBase64);
            console.log("[ANIME47][OK] Bước 2a: Parse input bằng formatter thành công.");
        } catch (formatParseError) { /* ... error handling ... */ return res.status(500).json({ error: `Failed to parse input using custom format: ${formatParseError.message}` });}

        // Bước 2b: Giải mã AES
        const decryptedBytes = CryptoJS.AES.decrypt(cipherParams, key);
        const decryptedJsonString = decryptedBytes.toString(CryptoJS.enc.Utf8);
        if (!decryptedJsonString && decryptedBytes.sigBytes > 0) { /* ... error handling ... */ return res.status(500).json({ error: "AES decryption failed, please check key." });}
        else if (!decryptedJsonString) { /* ... error handling ... */ return res.status(500).json({ error: "Decryption resulted in empty data. Check input." });}
        console.log(`[ANIME47][OK] Bước 2b: Giải mã AES thành công.`);

        // Bước 3: Parse JSON string -> Master Playlist URL
        let masterPlaylistUrl;
        try {
            masterPlaylistUrl = JSON.parse(decryptedJsonString);
            if (typeof masterPlaylistUrl !== 'string' || !masterPlaylistUrl.startsWith('http')) {throw new Error('Dữ liệu giải mã không phải là chuỗi URL hợp lệ.');}
            console.log(`[ANIME47][OK] Bước 3: Parse JSON thành công. Master Playlist URL: ${masterPlaylistUrl}`);
        } catch (parseError) {
            if (typeof decryptedJsonString === 'string' && decryptedJsonString.startsWith('http')) { masterPlaylistUrl = decryptedJsonString;}
            else { /* ... error handling ... */ return res.status(500).json({ error: "Decrypted data could not be interpreted as a valid URL." });}
        }

        // Bước 4: Fetch nội dung Master Playlist URL
        let m3u8Content;
        try {
            const response = await axios.get(masterPlaylistUrl, { /* ... headers ... */ timeout: 15000 });
            m3u8Content = response.data;
            if (typeof m3u8Content !== 'string') throw new Error('Response data is not a string.');
            console.log("[ANIME47][OK] Bước 4: Đã tải xong nội dung M3U8 gốc.");
        } catch (fetchError) { /* ... error handling ... */ return res.status(500).json({ error: `Failed to fetch master playlist from ${masterPlaylistUrl}`, details: fetchError.message });}
    // --- Kết thúc copy các bước 1-4 ---

    try { // Bắt đầu khối try cho các bước 5, 6, 7
        // Bước 5: Chỉnh sửa nội dung M3U8
        console.log("[ANIME47][...] Bước 5: Đang chỉnh sửa nội dung M3U8...");
        let modifiedM3u8Content;
        try {
            const lines = m3u8Content.split(/[\r\n]+/);
            modifiedM3u8Content = lines.map(line => {
                const trimmedLine = line.trim();
                if (trimmedLine && !trimmedLine.startsWith('#') && trimmedLine.startsWith('/')) {
                    return M3U8_BASE_URL_TO_PREPEND + trimmedLine;
                }
                return line;
            }).join('\n');
            console.log("[ANIME47][OK] Bước 5: Đã chỉnh sửa nội dung M3U8.");
        } catch (modifyError) {
            console.error("[ANIME47][LỖI] Bước 5: Lỗi khi chỉnh sửa nội dung M3U8:", modifyError);
            return res.status(500).json({ error: "Failed to modify M3U8 content.", details: modifyError.message });
        }

        // Bước 6: Lưu M3U8 đã chỉnh sửa và tạo URL
        let fileUrl;
        console.log("[ANIME47][...] Bước 6: Đang lưu file M3U8 đã chỉnh sửa...");
        try {
            await fs.mkdir(M3U8_FILESYSTEM_STORAGE_DIR, { recursive: true }); // Đảm bảo thư mục tồn tại

            const filename = `${uuidv4()}.m3u8`;
            const filePath = path.join(M3U8_FILESYSTEM_STORAGE_DIR, filename);
            await fs.writeFile(filePath, modifiedM3u8Content);
            console.log(`[ANIME47][OK] Bước 6a: Đã lưu file M3U8 tại: ${filePath}`);

            // Lên lịch xóa file này sau M3U8_FILE_LIFETIME_MS
            scheduleDeletion(filePath, M3U8_FILE_LIFETIME_MS);

            fileUrl = `${req.protocol}://${req.get('host')}${req.baseUrl}${M3U8_STATIC_ROUTE_SEGMENT}/${filename}`;
            console.log(`[ANIME47][OK] Bước 6b: URL của file M3U8 đã tạo: ${fileUrl}`);

        } catch (saveError) {
            console.error("[ANIME47][LỖI] Bước 6: Lỗi khi lưu file M3U8 hoặc tạo URL:", saveError);
            return res.status(500).json({ error: "Failed to save M3U8 file or create its URL.", details: saveError.message });
        }

        // Bước 7: Gửi phản hồi
        console.log("[ANIME47][OK] Bước 7: Gửi phản hồi JSON với URL của M3U8 đã chỉnh sửa.");
        res.status(200).json({ modifiedM3u8Url: fileUrl });

    } catch (error) { // Khối catch chung cho các bước 5, 6, 7 và các lỗi không lường trước
        console.error(`[ANIME47][LỖI TỔNG QUÁT SAU BƯỚC 4] /link/${base64EncodedJson.substring(0,30)}...:`, error);
        res.status(500).json({ error: `Server error after step 4: ${error.message}`, details: error.stack });
    }
});

// Tái sử dụng định nghĩa CryptoJSAesJson từ phiên bản trước
CryptoJSAesJson.stringify = function (cipherParams) {
    var jsonObj = { ct: cipherParams.ciphertext.toString(CryptoJS.enc.Base64) };
    if (cipherParams.iv) { jsonObj.iv = cipherParams.iv.toString(); }
    if (cipherParams.salt) { jsonObj.s = cipherParams.salt.toString(); }
    return JSON.stringify(jsonObj);
};
CryptoJSAesJson.parse = function (jsonStr) {
    try {
        var jsonObj = JSON.parse(jsonStr);
        var cipherParams = CryptoJS.lib.CipherParams.create({
            ciphertext: CryptoJS.enc.Base64.parse(jsonObj.ct)
        });
        if (jsonObj.iv) { cipherParams.iv = CryptoJS.enc.Hex.parse(jsonObj.iv); }
        if (jsonObj.s) { cipherParams.salt = CryptoJS.enc.Hex.parse(jsonObj.s); }
        return cipherParams;
    } catch (e) {
        console.error("Lỗi phân tích JSON trong CryptoJSAesJson.parse:", e);
        throw new Error("Dữ liệu đầu vào cho formatter không phải JSON hợp lệ.");
    }
};


module.exports = router;
