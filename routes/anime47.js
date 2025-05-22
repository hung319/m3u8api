// File: ./routes/anime47.js
const express = require('express');
const router = express.Router();
const CryptoJS = require("crypto-js");
// axios và url không còn cần thiết
// const Buffer = require('buffer').Buffer; // Buffer is global in Node.js

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
            // Giữ lại log lỗi này vì nó quan trọng cho việc debug formatter
            console.error("Lỗi phân tích JSON trong CryptoJSAesJson.parse:", e.message);
            throw new Error("Dữ liệu đầu vào cho formatter không phải JSON hợp lệ.");
        }
    }
};
// --- Kết thúc hằng số giải mã ---

// Bỏ async vì không còn await bên trong
router.get('/link/:base64data', (req, res) => {
    const base64EncodedJson = req.params.base64data;
    // Có thể giữ lại một log tối giản cho việc theo dõi request nếu cần
    // console.log(`Processing /link for: ${base64EncodedJson.substring(0,15)}...`);

    if (!base64EncodedJson) {
        // Không cần log ở đây vì client sẽ nhận được lỗi 400
        return res.status(400).json({ error: "Missing Base64 data in URL parameter." });
    }

    try {
        // Bước 1: Giải mã Base64 -> chuỗi JSON
        let jsonStringFromBase64;
        try {
            jsonStringFromBase64 = Buffer.from(base64EncodedJson, 'base64').toString('utf8');
        } catch (bufferError) {
            console.error("[LỖI B1] Lỗi giải mã Base64:", bufferError.message);
            return res.status(400).json({ error: "Invalid Base64 data provided." });
        }

        // Bước 2a: Parse chuỗi JSON bằng formatter để lấy đối tượng CipherParams
        let cipherParams;
        try {
            cipherParams = CryptoJSAesJson.parse(jsonStringFromBase64);
        } catch(formatParseError) {
            // Lỗi đã được log bên trong CryptoJSAesJson.parse
            return res.status(500).json({ error: `Failed to parse input using custom format: ${formatParseError.message}` });
        }

        // Bước 2b: Giải mã AES
        const decryptedBytes = CryptoJS.AES.decrypt(cipherParams, key);
        const decryptedJsonString = decryptedBytes.toString(CryptoJS.enc.Utf8);

        if (!decryptedJsonString) {
            // Kiểm tra xem có dữ liệu byte sau giải mã không, nếu có mà chuỗi Utf8 rỗng -> có thể là key sai
            if (decryptedBytes && decryptedBytes.sigBytes > 0) {
                console.error("[LỖI B2b] Giải mã AES thất bại (có thể sai key hoặc dữ liệu không phải UTF8 hợp lệ).");
                return res.status(500).json({ error: "AES decryption failed, possibly wrong key or invalid UTF8 data." });
            }
            console.warn("[LƯU Ý B2b] Giải mã thành công nhưng kết quả là chuỗi rỗng.");
            return res.status(500).json({ error: "Decryption resulted in empty data. Check input." });
        }
        // console.log(`[DEBUG] Decrypted string: ${decryptedJsonString}`); // Bỏ log này, chỉ bật khi debug sâu

        // Bước 3: Parse JSON string -> Master Playlist URL (Link 1)
        let masterPlaylistUrl;
        try {
            masterPlaylistUrl = JSON.parse(decryptedJsonString);
            if (typeof masterPlaylistUrl !== 'string' || !masterPlaylistUrl.startsWith('http')) {
                // Không cần log lỗi ở đây vì sẽ throw và catch ở dưới
                throw new Error('Dữ liệu giải mã không phải là chuỗi URL hợp lệ.');
            }
        } catch (parseError) {
            // Nếu decryptedJsonString là một URL hợp lệ, dùng nó luôn
            if (typeof decryptedJsonString === 'string' && decryptedJsonString.startsWith('http')) {
                console.warn(`[LƯU Ý B3] Không parse được JSON, dùng chuỗi giải mã gốc làm URL master: ${decryptedJsonString.substring(0,50)}...`);
                masterPlaylistUrl = decryptedJsonString;
            } else {
                console.error("[LỖI B3] Dữ liệu giải mã không phải JSON và cũng không phải URL hợp lệ:", parseError.message, `Input: ${decryptedJsonString.substring(0,100)}...`);
                return res.status(500).json({ error: "Decrypted data could not be interpreted as a valid URL." });
            }
        }

        // Trả về Master Playlist URL (Link 1)
        return res.status(200).json({ masterPlaylistUrl: masterPlaylistUrl });

    } catch (error) {
        // Lỗi chung không mong muốn
        console.error(`[LỖI CHUNG] Xử lý /link/${base64EncodedJson.substring(0,30)}... :`, error.message, error.stack);
        return res.status(500).json({ error: `Server error: ${error.message}` });
    }
});

module.exports = router;
