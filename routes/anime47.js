// File: ./routes/anime47.js
const express = require('express');
const router = express.Router();
const CryptoJS = require("crypto-js");
const axios = require('axios');
const url = require('url');

// --- Hằng số giải mã (giữ nguyên) ---
const key = "caphedaklak";

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
            console.error("Lỗi phân tích JSON trong CryptoJSAesJson.parse:", e);
            throw new Error("Dữ liệu đầu vào cho formatter không phải JSON hợp lệ.");
        }
    }
};
// --- Kết thúc hằng số giải mã ---

router.get('/link/:base64data', async (req, res) => {
    const base64EncodedJson = req.params.base64data;
    console.log(`\n--- Bắt đầu xử lý yêu cầu cho /link/${base64EncodedJson.substring(0, 30)}... ---`);

    if (!base64EncodedJson) {
        console.log("[LỖI] Thiếu dữ liệu Base64.");
        return res.status(400).json({ error: "Missing Base64 data in URL parameter." });
    }

    try {
        // Bước 1: Giải mã Base64 -> chuỗi JSON
        let jsonStringFromBase64;
        try {
            jsonStringFromBase64 = Buffer.from(base64EncodedJson, 'base64').toString('utf8');
            console.log("[OK] Bước 1: Giải mã Base64 thành công.");
        } catch (bufferError) {
            console.error("[LỖI] Bước 1: Lỗi giải mã Base64:", bufferError);
            return res.status(400).json({ error: "Invalid Base64 data provided." });
        }

        // Bước 2a: Tự parse chuỗi JSON bằng formatter để lấy đối tượng CipherParams
        let cipherParams;
        try {
            console.log("[...] Bước 2a: Đang parse input bằng formatter...");
            cipherParams = CryptoJSAesJson.parse(jsonStringFromBase64);
            console.log("[OK] Bước 2a: Parse input bằng formatter thành công.");
        } catch(formatParseError) {
            console.error("[LỖI] Bước 2a: Lỗi khi parse input bằng formatter:", formatParseError);
            return res.status(500).json({ error: `Failed to parse input using custom format: ${formatParseError.message}` });
        }

        // Bước 2b: Giải mã AES sử dụng đối tượng CipherParams và key
        console.log("[...] Bước 2b: Đang giải mã AES từ CipherParams...");
        const decryptedBytes = CryptoJS.AES.decrypt(cipherParams, key); 

        const decryptedJsonString = decryptedBytes.toString(CryptoJS.enc.Utf8);

        if (!decryptedJsonString && decryptedBytes.sigBytes > 0) {
            console.error("[LỖI] Bước 2b: Giải mã AES thất bại (có thể sai key).");
            return res.status(500).json({ error: "AES decryption failed, please check key." });
        } else if (!decryptedJsonString) {
            console.warn("[LỖI] Bước 2b: Giải mã thành công nhưng kết quả rỗng.");
            return res.status(500).json({ error: "Decryption resulted in empty data. Check input." });
        }
        console.log(`[OK] Bước 2b: Giải mã AES thành công. Kết quả chuỗi: ${decryptedJsonString}`);

        // Bước 3: Parse JSON string -> Master Playlist URL (Link 1)
        let masterPlaylistUrl;
        try {
            masterPlaylistUrl = JSON.parse(decryptedJsonString);
            if (typeof masterPlaylistUrl !== 'string' || !masterPlaylistUrl.startsWith('http')) {
                throw new Error('Dữ liệu giải mã không phải là chuỗi URL hợp lệ.');
            }
            console.log(`[OK] Bước 3: Parse JSON thành công. Master Playlist URL (Link 1): ${masterPlaylistUrl}`);
        } catch (parseError) {
            if (typeof decryptedJsonString === 'string' && decryptedJsonString.startsWith('http')) {
                console.warn(`[WARN] Bước 3: Không parse được JSON, dùng chuỗi giải mã gốc làm URL master: ${decryptedJsonString}`);
                masterPlaylistUrl = decryptedJsonString; // Sử dụng trực tiếp chuỗi nếu nó là URL
            } else {
                console.error("[LỖI] Bước 3: Dữ liệu giải mã không thể diễn giải thành URL:", parseError.message);
                return res.status(500).json({ error: "Decrypted data could not be interpreted as a valid URL." });
            }
        }

        // === THAY ĐỔI CHÍNH: TRẢ VỀ MASTER PLAYLIST URL (LINK 1) ===
        console.log("[OK] Hoàn tất: Trả về Master Playlist URL (Link 1).");
        res.status(200).json({ masterPlaylistUrl: masterPlaylistUrl }); // Trả về Link 1

        /*
        // --- CÁC BƯỚC 4, 5, 6 KHÔNG CẦN THIẾT NỮA CHO YÊU CẦU NÀY ---
        
        // Step 4: Fetch the content of the Master Playlist URL
        let m3u8Content;
        try {
            console.log(`[...] Bước 4: Đang tải master playlist từ: ${masterPlaylistUrl}`);
            const response = await axios.get(masterPlaylistUrl, {
                timeout: 15000 ,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Linux; Android 14; SM-S711B Build/UP1A.231005.007) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.7049.111 Mobile Safari/537.36',
                    'Referer': 'https://anime47.lat/'
                }
            });
            m3u8Content = response.data;
            if (typeof m3u8Content !== 'string') {
                console.error("[LỖI] Bước 4: Dữ liệu tải về không phải dạng chuỗi.", typeof m3u8Content);
                throw new Error('Response data is not a string.');
            }
            if (!m3u8Content.includes('#EXTM3U')) {
                console.warn("[WARN] Bước 4: Dữ liệu tải về có vẻ không phải M3U8 (thiếu #EXTM3U).");
            }
            console.log("[OK] Bước 4: Đã tải xong nội dung M3U8.");
            // console.log("--- Nội dung M3U8 (vài dòng đầu) ---");
            // console.log(m3u8Content.split('\n').slice(0, 5).join('\n'));
            // console.log("--- Kết thúc nội dung M3U8 ---");

        } catch (fetchError) {
            console.error(`[LỖI] Bước 4: Lỗi khi tải master playlist (${masterPlaylistUrl}):`, fetchError.response?.status, fetchError.message);
            return res.status(500).json({
                error: `Failed to fetch master playlist content from ${masterPlaylistUrl}`,
                details: fetchError.message
            });
        }

        // Step 5: Parse M3U8 content -> Stream URL Path
        let streamUrlPath = null;
        console.log("[...] Bước 5: Đang phân tích nội dung M3U8...");
        const lines = m3u8Content.split(/[\r\n]+/);
        for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine && !trimmedLine.startsWith('#')) {
                streamUrlPath = trimmedLine;
                console.log(`[OK] Bước 5: Tìm thấy đường dẫn stream: ${streamUrlPath}`);
                break;
            }
        }

        if (!streamUrlPath) {
            console.error("[LỖI] Bước 5: Không tìm thấy đường dẫn stream trong nội dung M3U8.");
            // console.error("Nội dung M3U8 đầy đủ:\n", m3u8Content); // Có thể log ra nếu cần debug sâu
            return res.status(500).json({ error: "Could not parse stream URL path from the master playlist." });
        }

        // Step 6: Construct final absolute URL (Link 2)
        let finalStreamUrl;
        console.log("[...] Bước 6: Đang tạo URL cuối cùng...");
        try {
            finalStreamUrl = new url.URL(streamUrlPath, masterPlaylistUrl).href;
            console.log(`[OK] Bước 6: URL cuối cùng được tạo: ${finalStreamUrl}`);
        } catch (urlError) {
            console.error("[LỖI] Bước 6: Lỗi khi tạo URL cuối cùng:", urlError);
            return res.status(500).json({ error: "Could not construct final stream URL." });
        }

        // Step 7: Send response (ORIGINAL - NOW COMMENTED OUT)
        // console.log("[OK] Bước 7: Gửi phản hồi JSON.");
        // res.status(200).json({ decryptedResult: finalStreamUrl });
        */

    } catch (error) {
        console.error(`[LỖI] Lỗi chung khi xử lý /link/${req.params.base64data}:`, error);
        res.status(500).json({ error: `Server error: ${error.message}` });
    }
});

module.exports = router;
