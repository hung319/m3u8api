// File: ./routes/anime47.js
const express = require('express');
const router = express.Router();
const CryptoJS = require("crypto-js");

// --- Hằng số giải mã ---
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

// Định nghĩa route: GET /anime47/link/:base64data
router.get('/link/:base64data', (req, res) => {
    const base64EncodedJson = req.params.base64data;

    if (!base64EncodedJson) {
        return res.status(400).json({ error: "Thiếu dữ liệu Base64 trong tham số URL." });
    }

    try {
        // Bước 1: Giải mã Base64 -> chuỗi JSON
        let jsonStringFromBase64;
        try {
             jsonStringFromBase64 = Buffer.from(base64EncodedJson, 'base64').toString('utf8');
        } catch (bufferError) {
             console.error("Lỗi giải mã Base64:", bufferError);
             return res.status(400).json({ error: "Dữ liệu Base64 không hợp lệ." });
        }

        // Bước 2: Giải mã AES -> chuỗi UTF8
        const decryptedBytes = CryptoJS.AES.decrypt(jsonStringFromBase64, key, { format: CryptoJSAesJson });
        const decryptedJsonString = decryptedBytes.toString(CryptoJS.enc.Utf8);

        if (!decryptedJsonString && decryptedBytes.sigBytes > 0) {
             console.error("Giải mã AES thất bại (có thể sai key).");
             return res.status(500).json({ error: "Giải mã AES thất bại, vui lòng kiểm tra lại key." });
        } else if (!decryptedJsonString) {
             console.warn("Giải mã thành công nhưng kết quả rỗng.");
             return res.status(500).json({ error: "Giải mã thành công nhưng kết quả rỗng. Kiểm tra lại dữ liệu đầu vào." });
        }

        // Bước 3: Parse chuỗi JSON (nếu cần)
        let actualDecryptedData;
        try {
            actualDecryptedData = JSON.parse(decryptedJsonString);
        } catch (parseError) {
            console.warn("Cảnh báo: Không thể parse JSON từ dữ liệu đã giải mã. Trả về chuỗi gốc.", parseError.message);
            actualDecryptedData = decryptedJsonString;
        }

        // Gửi phản hồi thành công
        res.status(200).json({ decryptedResult: actualDecryptedData });

    } catch (error) {
        console.error(`Lỗi khi xử lý /link/${base64EncodedJson}:`, error);
        res.status(500).json({ error: `Lỗi Server: ${error.message}` });
    }
});

module.exports = router; // Export router
