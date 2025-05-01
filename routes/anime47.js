// File: ./routes/anime47.js
const express = require('express');
const router = express.Router();
const CryptoJS = require("crypto-js");
const axios = require('axios'); // Thêm thư viện axios để tải nội dung URL
const url = require('url'); // Thêm module url để xử lý URL

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

// Định nghĩa route - thêm async để dùng await với axios
router.get('/link/:base64data', async (req, res) => { // Sử dụng async
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

        // Bước 2: Giải mã AES -> chuỗi JSON chứa URL master playlist
        const decryptedBytes = CryptoJS.AES.decrypt(jsonStringFromBase64, key, { format: CryptoJSAesJson });
        const decryptedJsonString = decryptedBytes.toString(CryptoJS.enc.Utf8);

        if (!decryptedJsonString && decryptedBytes.sigBytes > 0) {
             console.error("Giải mã AES thất bại (có thể sai key).");
             return res.status(500).json({ error: "Giải mã AES thất bại, vui lòng kiểm tra lại key." });
        } else if (!decryptedJsonString) {
             console.warn("Giải mã thành công nhưng kết quả rỗng.");
             return res.status(500).json({ error: "Giải mã thành công nhưng kết quả rỗng. Kiểm tra lại dữ liệu đầu vào." });
        }

        // Bước 3: Parse JSON để lấy URL master playlist (Link 1)
        let masterPlaylistUrl; // Ví dụ: https://cdn.animevui.com/file/...
         try {
            masterPlaylistUrl = JSON.parse(decryptedJsonString);
            if (typeof masterPlaylistUrl !== 'string' || !masterPlaylistUrl.startsWith('http')) {
                 throw new Error('Dữ liệu giải mã không phải là chuỗi URL hợp lệ.');
            }
        } catch (parseError) {
             // Fallback nếu không parse được JSON
             if (typeof decryptedJsonString === 'string' && decryptedJsonString.startsWith('http')) {
                 console.warn("Cảnh báo: Không parse được JSON URL, dùng chuỗi giải mã gốc làm URL master.");
                 masterPlaylistUrl = decryptedJsonString;
             } else {
                console.error("Dữ liệu giải mã không thể diễn giải thành URL:", parseError.message);
                return res.status(500).json({ error: "Dữ liệu giải mã không thể diễn giải thành URL hợp lệ." });
             }
        }

        // Bước 4: Tải nội dung của master playlist URL
        let m3u8Content;
        try {
            console.log(`Đang tải master playlist từ: ${masterPlaylistUrl}`);
            const response = await axios.get(masterPlaylistUrl, { timeout: 15000 }); // Tăng timeout lên 15s
            m3u8Content = response.data;
            // Kiểm tra cơ bản nội dung M3U8
            if (typeof m3u8Content !== 'string' || !m3u8Content.includes('#EXTM3U')) {
                throw new Error('Dữ liệu trả về không phải là playlist M3U8 hợp lệ.');
            }
            console.log("Đã tải xong nội dung M3U8.");
        } catch (fetchError) {
            console.error(`Lỗi khi tải master playlist (${masterPlaylistUrl}):`, fetchError.response?.status, fetchError.message);
            return res.status(500).json({
                error: `Không thể tải nội dung master playlist từ ${masterPlaylistUrl}`,
                details: fetchError.message
            });
        }

        // Bước 5: Phân tích nội dung M3U8 để tìm đường dẫn stream playlist
        let streamUrlPath = null;
        const lines = m3u8Content.split('\n');
        for (const line of lines) {
            const trimmedLine = line.trim();
            // Tìm dòng đầu tiên không phải comment và không rỗng
            if (trimmedLine && !trimmedLine.startsWith('#')) {
                streamUrlPath = trimmedLine;
                console.log(`Tìm thấy đường dẫn stream playlist: ${streamUrlPath}`);
                break;
            }
        }

        if (!streamUrlPath) {
            console.error("Không tìm thấy đường dẫn stream trong nội dung M3U8:", m3u8Content);
            return res.status(500).json({ error: "Không thể phân tích đường dẫn stream từ master playlist." });
        }

        // Bước 6: Tạo URL tuyệt đối cuối cùng (Link 2)
        let finalStreamUrl;
        try {
             // Sử dụng url.resolve để xử lý đường dẫn tương đối (kể cả có dấu / ở đầu hay không)
             finalStreamUrl = new url.URL(streamUrlPath, masterPlaylistUrl).href;
             console.log(`URL cuối cùng được tạo: ${finalStreamUrl}`);
        } catch (urlError) {
             console.error("Lỗi khi tạo URL cuối cùng:", urlError);
             return res.status(500).json({ error: "Không thể tạo URL stream cuối cùng." });
        }

        // Bước 7: Gửi phản hồi JSON chứa link cuối cùng
        res.status(200).json({ decryptedResult: finalStreamUrl });

    } catch (error) {
        // Bắt lỗi chung
        console.error(`Lỗi chung khi xử lý /link/${req.params.base64data}:`, error);
        res.status(500).json({ error: `Lỗi Server: ${error.message}` });
    }
});

module.exports = router;
