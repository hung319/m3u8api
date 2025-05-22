// File: ./routes/anime47.js
const express = require('express');
const router = express.Router();
const CryptoJS = require("crypto-js");
// axios và url không còn cần thiết nếu chỉ trả về masterPlaylistUrl
// const axios = require('axios');
// const url = require('url');

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

        // Trả về Master Playlist URL (Link 1)
        console.log("[OK] Hoàn tất: Trả về Master Playlist URL (Link 1).");
        res.status(200).json({ masterPlaylistUrl: masterPlaylistUrl });

    } catch (error) {
        console.error(`[LỖI] Lỗi chung khi xử lý /link/${req.params.base64data}:`, error);
        res.status(500).json({ error: `Server error: ${error.message}` });
    }
});

module.exports = router;
