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
const key = "caphedaklak"; // QUAN TRỌNG: Bảo vệ key này cẩn thận!

// --- Đối tượng CryptoJSAesJson ---
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
            if (jsonObj.iv) { cipherParams.iv = CryptoJS.enc.Hex.parse(jsonObj.iv); }
            if (jsonObj.s) { cipherParams.salt = CryptoJS.enc.Hex.parse(jsonObj.s); }
            return cipherParams;
        } catch (e) {
            console.error("[ANIME47] Lỗi phân tích JSON trong CryptoJSAesJson.parse:", e);
            throw new Error("Dữ liệu đầu vào cho CryptoJSAesJson.parse không phải JSON hợp lệ.");
        }
    }
};

// --- Cấu hình M3U8 ---
const M3U8_STORAGE_SUBDIR_NAME = 'generated_m3u8s';
const M3U8_FILE_LIFETIME_MS = 12 * 60 * 60 * 1000; // 12 giờ
const M3U8_STATIC_ROUTE_SEGMENT = '/files';
const M3U8_FILESYSTEM_STORAGE_DIR = path.join(__dirname, '..', 'public', M3U8_STORAGE_SUBDIR_NAME);
const MAX_TIMEOUT_DELAY = 2147483647;

// --- Cấu hình Proxy cho TS Link ---
const PROXY_BASE_URL = "https://prxclf.013666.xyz/";
const PROXY_AUTH_TOKEN = "11042006";

// --- Phục vụ file tĩnh ---
router.use(M3U8_STATIC_ROUTE_SEGMENT, express.static(M3U8_FILESYSTEM_STORAGE_DIR, { maxAge: '1h' }));
console.log(`[ANIME47] Sẵn sàng phục vụ file M3U8 tĩnh từ ${M3U8_FILESYSTEM_STORAGE_DIR} tại route <base_anime47_path>${M3U8_STATIC_ROUTE_SEGMENT}`);

// --- Logic xóa file và lên lịch xóa ---
async function deleteFile(filePath) {
    try {
        await fs.unlink(filePath);
        console.log(`[ANIME47][DELETE] Đã xóa file: ${filePath}`);
    } catch (err) {
        if (err.code !== 'ENOENT') {
            console.error(`[ANIME47][DELETE] Lỗi khi xóa file ${filePath}:`, err);
        }
    }
}

function scheduleDeletion(filePath, delayMs) {
    if (delayMs <= 0) {
        console.log(`[ANIME47][SCHED] File ${filePath} đã quá hạn. Xóa ngay.`);
        deleteFile(filePath).catch(err => console.error(`[ANIME47][SCHED] Lỗi khi xóa file (quá hạn) ${filePath}:`, err));
    } else {
        const effectiveDelay = Math.min(delayMs, MAX_TIMEOUT_DELAY);
        setTimeout(() => {
            console.log(`[ANIME47][SCHED-TIMER] Timer: Thời gian chờ của file ${filePath} đã hết. Xóa.`);
            deleteFile(filePath).catch(err => console.error(`[ANIME47][SCHED-TIMER] Lỗi khi xóa file ${filePath} bằng timer:`, err));
        }, effectiveDelay);
        console.log(`[ANIME47][SCHED] Đã lên lịch xóa file ${filePath} sau ~${Math.round(effectiveDelay / 1000 / 60)} phút.`);
    }
}

// --- Quét file cũ khi khởi động ---
async function performStartupScanAndScheduleDeletions() {
    console.log('[ANIME47][STARTUP_SCAN] Bắt đầu quét file M3U8 cũ...');
    try {
        await fs.mkdir(M3U8_FILESYSTEM_STORAGE_DIR, { recursive: true });
    } catch (mkdirErr) {
        console.error(`[ANIME47][STARTUP_SCAN] Không thể tạo/truy cập thư mục ${M3U8_FILESYSTEM_STORAGE_DIR}:`, mkdirErr);
        return;
    }
    try {
        const files = await fs.readdir(M3U8_FILESYSTEM_STORAGE_DIR);
        const now = Date.now();
        let scheduled = 0, immediateDelete = 0;
        if (files.length === 0) console.log('[ANIME47][STARTUP_SCAN] Không có file nào để quét.');
        for (const file of files) {
            if (file.endsWith('.m3u8')) {
                const filePath = path.join(M3U8_FILESYSTEM_STORAGE_DIR, file);
                try {
                    const stats = await fs.stat(filePath);
                    const remainingTime = M3U8_FILE_LIFETIME_MS - (now - stats.mtimeMs);
                    scheduleDeletion(filePath, remainingTime);
                    if (remainingTime <= 0) immediateDelete++; else scheduled++;
                } catch (statErr) {
                    if (statErr.code !== 'ENOENT') console.error(`[ANIME47][STARTUP_SCAN] Lỗi stat file ${filePath}:`, statErr);
                }
            }
        }
        console.log(`[ANIME47][STARTUP_SCAN] Quét xong. Xóa ngay: ${immediateDelete}. Lên lịch xóa: ${scheduled}.`);
    } catch (err) {
        console.error('[ANIME47][STARTUP_SCAN] Lỗi nghiêm trọng khi quét file:', err);
    }
}
performStartupScanAndScheduleDeletions().catch(err => console.error('[ANIME47][CRITICAL_STARTUP_ERROR]', err));

// --- Headers chung cho Axios ---
const AXIOS_REQUEST_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
};

// --- Route xử lý chính ---
router.get('/link/:base64data', async (req, res) => {
    const base64EncodedJson = req.params.base64data;
    
    // --- CẬP NHẬT LOGIC LẤY REFERER ---
    let clientReferer = req.headers.referer || req.query.referer; 

    console.log(`\n[ANIME47] --- Bắt đầu xử lý yêu cầu cho /link/${base64EncodedJson.substring(0, 30)}... ---`);
    
    if (req.headers.referer) {
        console.log(`[ANIME47][INFO] Referer nhận từ HTTP header của client: ${req.headers.referer}`);
    } else if (req.query.referer) {
        console.log(`[ANIME47][INFO] Referer nhận từ query parameter của client: ${req.query.referer}`);
    }

    if (!clientReferer) {
        console.log("[ANIME47][LỖI] Thiếu thông tin 'referer'. Vui lòng gửi qua HTTP header 'referer' hoặc query parameter 'referer'.");
        return res.status(400).json({ error: "Missing 'referer'. Please send it as an HTTP 'referer' header or as a 'referer' query parameter." });
    }
    // --- KẾT THÚC CẬP NHẬT LOGIC LẤY REFERER ---

    if (!base64EncodedJson) {
        console.log("[ANIME47][LỖI] Thiếu dữ liệu Base64.");
        return res.status(400).json({ error: "Missing Base64 data in URL parameter." });
    }

    let initialMasterPlaylistUrl;
    let initialM3u8Content;
    let actualPlaylistUrlToProcess;
    let contentToProcess;

    try {
        // Bước 1 & 2: Giải mã Base64 và AES
        let decryptedJsonString;
        try {
            const jsonStringFromBase64 = Buffer.from(base64EncodedJson, 'base64').toString('utf8');
            const cipherParams = CryptoJSAesJson.parse(jsonStringFromBase64);
            const decryptedBytes = CryptoJS.AES.decrypt(cipherParams, key);
            decryptedJsonString = decryptedBytes.toString(CryptoJS.enc.Utf8);
            if (!decryptedJsonString && decryptedBytes.sigBytes > 0) throw new Error("Giải mã AES thất bại, có thể sai key.");
            if (!decryptedJsonString) throw new Error("Giải mã thành công nhưng kết quả rỗng.");
            console.log("[ANIME47][OK] Bước 1 & 2: Giải mã Base64 và AES thành công.");
        } catch (decryptionError) {
            console.error("[ANIME47][LỖI] Bước 1 & 2: Lỗi giải mã:", decryptionError);
            return res.status(500).json({ error: "Decryption failed.", details: decryptionError.message });
        }

        // Bước 3: Parse JSON string -> initialMasterPlaylistUrl
        try {
            initialMasterPlaylistUrl = JSON.parse(decryptedJsonString);
            if (typeof initialMasterPlaylistUrl !== 'string' || !initialMasterPlaylistUrl.startsWith('http')) {
                throw new Error('Dữ liệu giải mã không phải là chuỗi URL hợp lệ.');
            }
            console.log(`[ANIME47][OK] Bước 3: Parse JSON thành công. URL M3U8 ban đầu: ${initialMasterPlaylistUrl}`);
        } catch (parseError) {
            if (typeof decryptedJsonString === 'string' && decryptedJsonString.startsWith('http')) {
                initialMasterPlaylistUrl = decryptedJsonString;
                console.warn(`[ANIME47][WARN] Bước 3: Không parse được JSON, dùng chuỗi gốc làm URL: ${initialMasterPlaylistUrl}`);
            } else {
                console.error("[ANIME47][LỖI] Bước 3: Không thể diễn giải thành URL:", parseError);
                return res.status(500).json({ error: "Decrypted data not a valid URL." });
            }
        }

        // Bước 4a: Tải nội dung M3U8 ban đầu
        try {
            console.log(`[ANIME47][...] Bước 4a: Đang tải M3U8 ban đầu từ: ${initialMasterPlaylistUrl}`);
            const response = await axios.get(initialMasterPlaylistUrl, {
                timeout: 20000,
                headers: { ...AXIOS_REQUEST_HEADERS, 'Referer': new url.URL(initialMasterPlaylistUrl).origin + '/' }
            });
            initialM3u8Content = response.data;
            if (typeof initialM3u8Content !== 'string') throw new Error('Nội dung M3U8 ban đầu không phải string.');
            console.log("[ANIME47][OK] Bước 4a: Đã tải xong nội dung M3U8 ban đầu.");
        } catch (fetchInitialError) {
            console.error(`[ANIME47][LỖI] Bước 4a: Lỗi tải M3U8 ban đầu (${initialMasterPlaylistUrl}):`, fetchInitialError.message);
            return res.status(500).json({ error: `Failed to fetch initial M3U8: ${initialMasterPlaylistUrl}`, details: fetchInitialError.message });
        }

        // Bước 4b & 4c: Kiểm tra và tải media playlist nếu M3U8 ban đầu là master
        actualPlaylistUrlToProcess = initialMasterPlaylistUrl;
        contentToProcess = initialM3u8Content;

        const linesInitial = initialM3u8Content.split(/[\r\n]+/);
        let isMaster = false;
        let potentialMediaPlaylistPath = null;

        for (let i = 0; i < linesInitial.length; i++) {
            const line = linesInitial[i].trim();
            if (line.startsWith('#EXT-X-STREAM-INF')) {
                isMaster = true;
                for (let j = i + 1; j < linesInitial.length; j++) {
                    const nextLine = linesInitial[j].trim();
                    if (nextLine && !nextLine.startsWith('#')) {
                        potentialMediaPlaylistPath = nextLine;
                        break;
                    }
                }
                break;
            }
            if (line.startsWith('#EXTINF:')) {
                isMaster = false;
                break;
            }
        }

        if (isMaster && potentialMediaPlaylistPath) {
            console.log(`[ANIME47][INFO] Phát hiện master playlist. Đường dẫn media playlist con: ${potentialMediaPlaylistPath}`);
            try {
                actualPlaylistUrlToProcess = new url.URL(potentialMediaPlaylistPath, initialMasterPlaylistUrl).href;
                console.log(`[ANIME47][...] Bước 4c: Đang tải media playlist từ: ${actualPlaylistUrlToProcess}`);
                const responseMedia = await axios.get(actualPlaylistUrlToProcess, {
                    timeout: 20000,
                    headers: { ...AXIOS_REQUEST_HEADERS, 'Referer': new url.URL(actualPlaylistUrlToProcess).origin + '/' }
                });
                contentToProcess = responseMedia.data;
                if (typeof contentToProcess !== 'string') throw new Error('Nội dung media playlist không phải string.');
                console.log("[ANIME47][OK] Bước 4c: Đã tải xong nội dung media playlist.");
            } catch (fetchMediaError) {
                console.error(`[ANIME47][LỖI] Bước 4c: Lỗi tải media playlist (${actualPlaylistUrlToProcess}):`, fetchMediaError.message);
                return res.status(500).json({ error: `Failed to fetch media playlist: ${actualPlaylistUrlToProcess}`, details: fetchMediaError.message });
            }
        } else if (isMaster && !potentialMediaPlaylistPath) {
            console.warn("[ANIME47][WARN] Là master playlist nhưng không tìm thấy media playlist con. Sẽ xử lý master playlist.");
        } else {
            console.log("[ANIME47][INFO] M3U8 ban đầu có vẻ là media playlist. Xử lý trực tiếp.");
        }

        // Bước 5: Chỉnh sửa contentToProcess (nội dung của media playlist)
        console.log("[ANIME47][...] Bước 5: Đang chỉnh sửa nội dung M3U8 (thêm proxy và đảm bảo URL tuyệt đối)...");
        let modifiedM3u8Content;
        try {
            const linesToProcess = contentToProcess.split(/[\r\n]+/);
            modifiedM3u8Content = linesToProcess.map(line => {
                const trimmedLine = line.trim();
                if (!trimmedLine) return "";

                if (trimmedLine.startsWith('#EXTM3U') || 
                    trimmedLine.startsWith('#EXT-X-VERSION') ||
                    trimmedLine.startsWith('#EXT-X-TARGETDURATION') ||
                    trimmedLine.startsWith('#EXT-X-MEDIA-SEQUENCE') ||
                    trimmedLine.startsWith('#EXT-X-PLAYLIST-TYPE') ||
                    trimmedLine.startsWith('#EXT-X-ENDLIST') ||
                    trimmedLine.startsWith('#EXTINF') ||
                    trimmedLine.startsWith('#EXT-X-DISCONTINUITY') ||
                    trimmedLine.startsWith('#EXT-X-PROGRAM-DATE-TIME') ||
                    trimmedLine.startsWith('#EXT-X-BYTERANGE')) {
                    return line;
                }

                let resolvedUrl;

                if (trimmedLine.includes('URI="')) {
                    const uriMatch = trimmedLine.match(/URI="([^"]+)"/);
                    if (uriMatch && uriMatch[1]) {
                        const relativeUri = uriMatch[1];
                        if (relativeUri.startsWith('http://') || relativeUri.startsWith('https://') || relativeUri.startsWith('data:')) {
                            resolvedUrl = relativeUri;
                        } else {
                            try {
                                resolvedUrl = new url.URL(relativeUri, actualPlaylistUrlToProcess).href;
                            } catch (e) {
                                console.warn(`[ANIME47][WARN] Bước 5: Không thể phân giải URI "${relativeUri}" (base: ${actualPlaylistUrlToProcess}). Giữ nguyên dòng.`);
                                return line;
                            }
                        }
                        // Hiện tại không bọc proxy cho key URI. Nếu cần, thêm logic ở đây.
                        return trimmedLine.replace(uriMatch[0], `URI="${resolvedUrl}"`);
                    }
                } 
                else if (!trimmedLine.startsWith('#')) { // URL segment
                    if (trimmedLine.startsWith('http://') || trimmedLine.startsWith('https://')) {
                        resolvedUrl = trimmedLine;
                    } else {
                        try {
                            resolvedUrl = new url.URL(trimmedLine, actualPlaylistUrlToProcess).href;
                        } catch (e) {
                            console.warn(`[ANIME47][WARN] Bước 5: Không thể phân giải URL segment "${trimmedLine}" (base: ${actualPlaylistUrlToProcess}). Giữ nguyên dòng.`);
                            return line;
                        }
                    }

                    // Bọc proxy cho link .ts
                    if (resolvedUrl.endsWith('.ts')) { // Hoặc kiểm tra các đuôi file media khác nếu cần
                        try {
                            const encodedOriginalUrl = encodeURIComponent(resolvedUrl);
                            const encodedClientRef = encodeURIComponent(clientReferer); // clientReferer đã được lấy ở đầu route
                            return `${PROXY_BASE_URL}?url=${encodedOriginalUrl}&referer=${encodedClientRef}&auth_token=${PROXY_AUTH_TOKEN}`;
                        } catch (e) {
                            console.warn(`[ANIME47][WARN] Bước 5: Lỗi khi mã hóa URL cho proxy: ${resolvedUrl}. Lỗi: ${e.message}. Trả về URL đã phân giải.`);
                            return resolvedUrl;
                        }
                    } else {
                        return resolvedUrl;
                    }
                }
                return line;
            }).filter(line => line !== null).join('\n');
            
            const isLiveStream = contentToProcess.toUpperCase().includes("#EXT-X-PLAYLIST-TYPE:LIVE");
            if (!isLiveStream && !modifiedM3u8Content.includes("#EXT-X-ENDLIST")) {
                // Kiểm tra kỹ hơn để tránh thêm nhiều lần nếu join('\n') thêm dòng trống
                const tempContentCheck = modifiedM3u8Content.trim();
                if (!tempContentCheck.endsWith("#EXT-X-ENDLIST")) {
                    modifiedM3u8Content = tempContentCheck + "\n#EXT-X-ENDLIST\n";
                }
                console.log("[ANIME47][INFO] Bước 5: Đã thêm #EXT-X-ENDLIST vào cuối M3U8 (do không phải LIVE và chưa có).");
            }

            console.log("[ANIME47][OK] Bước 5: Đã chỉnh sửa nội dung M3U8.");
        } catch (modifyError) {
            console.error("[ANIME47][LỖI] Bước 5: Lỗi khi chỉnh sửa M3U8:", modifyError);
            return res.status(500).json({ error: "Failed to modify M3U8 content.", details: modifyError.message });
        }

        // Bước 6: Lưu M3U8, lên lịch xóa, tạo URL
        let fileUrl;
        console.log("[ANIME47][...] Bước 6: Đang lưu file M3U8...");
        try {
            await fs.mkdir(M3U8_FILESYSTEM_STORAGE_DIR, { recursive: true });
            const filename = `${uuidv4()}.m3u8`;
            const filePath = path.join(M3U8_FILESYSTEM_STORAGE_DIR, filename);
            await fs.writeFile(filePath, modifiedM3u8Content);
            console.log(`[ANIME47][OK] Bước 6a: Đã lưu file M3U8 tại: ${filePath}`);
            scheduleDeletion(filePath, M3U8_FILE_LIFETIME_MS);
            fileUrl = `${req.protocol}://${req.get('host')}${req.baseUrl}${M3U8_STATIC_ROUTE_SEGMENT}/${filename}`;
            console.log(`[ANIME47][OK] Bước 6b: URL file M3U8 đã tạo: ${fileUrl}`);
        } catch (saveError) {
            console.error("[ANIME47][LỖI] Bước 6: Lỗi lưu file hoặc tạo URL:", saveError);
            return res.status(500).json({ error: "Failed to save M3U8 file or create URL.", details: saveError.message });
        }

        // Bước 7: Gửi phản hồi
        console.log("[ANIME47][OK] Bước 7: Gửi phản hồi JSON.");
        res.status(200).json({ modifiedM3u8Url: fileUrl });

    } catch (error) {
        console.error(`[ANIME47][LỖI TỔNG QUÁT] /link/${base64EncodedJson.substring(0,30)}...:`, error);
        res.status(500).json({ error: `Server error: ${error.message}`, details: error.stack });
    }
});

module.exports = router;
