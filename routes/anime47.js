// File: ./routes/anime47.js
const express = require('express');
const router = express.Router();
const CryptoJS = require("crypto-js");
const axios = require('axios');
const url = require('url');
const fs = require('fs').promises; // Thêm module fs.promises
const path = require('path');     // Thêm module path
const { v4: uuidv4 } = require('uuid'); // Thêm module uuid

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

// --- Cấu hình cho việc chỉnh sửa và lưu file M3U8 ---
const M3U8_BASE_URL_TO_PREPEND = "https://pl.vlogphim.net"; // URL bạn muốn thêm vào đầu mỗi segment
const M3U8_STORAGE_DIR_NAME = 'generated_m3u8s';          // Tên thư mục con trong 'public' để lưu file
const M3U8_FILE_LIFETIME_MS = 12 * 60 * 60 * 1000;         // 12 giờ tính bằng mili giây

// Biến lưu trữ các file đã tạo (cho việc dọn dẹp cơ bản)
// Lưu ý: Giải pháp này đơn giản và chỉ hoạt động tốt trên một server instance.
// Để có giải pháp dọn dẹp mạnh mẽ và chính xác 12 giờ, hãy cân nhắc dùng node-cron.
let createdM3u8Files = [];

async function cleanupOldFiles() {
    const now = Date.now();
    const filesToKeep = [];
    const filesToDelete = [];
    let m3u8StorageDirFound = false; // Biến để kiểm tra thư mục lưu trữ

    console.log('[DỌN DẸP] Đang kiểm tra các file M3U8 cũ...');

    // Xác định đường dẫn thư mục lưu trữ một cách an toàn
    let m3u8StoragePath;
    try {
        // Giả sử file này nằm trong ./routes, ta cần đi lên 1 cấp rồi vào public
        m3u8StoragePath = path.join(__dirname, '..', 'public', M3U8_STORAGE_DIR_NAME);
        await fs.access(m3u8StoragePath); // Kiểm tra thư mục có tồn tại không
        m3u8StorageDirFound = true;
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log(`[DỌN DẸP] Thư mục lưu trữ ${m3u8StoragePath} không tồn tại. Bỏ qua dọn dẹp từ danh sách trong bộ nhớ.`);
            // Nếu thư mục không tồn tại, có thể không có file nào để dọn từ danh sách createdM3u8Files
            // Hoặc có thể muốn dọn dẹp createdM3u8Files nếu các file không còn nữa.
            // Hiện tại, chúng ta sẽ chỉ không cố gắng xóa file nếu thư mục không có.
        } else {
            console.error(`[DỌN DẸP] Lỗi khi truy cập thư mục ${m3u8StoragePath}:`, error);
        }
        createdM3u8Files = []; // Xóa danh sách nếu không thể truy cập thư mục
        return;
    }


    // Nếu sử dụng danh sách createdM3u8Files (chỉ hiệu quả với single instance)
    for (const fileRecord of createdM3u8Files) {
        if ((now - fileRecord.creationTime) > M3U8_FILE_LIFETIME_MS) {
            filesToDelete.push(fileRecord);
        } else {
            filesToKeep.push(fileRecord);
        }
    }

    for (const fileRecord of filesToDelete) {
        try {
            if (m3u8StorageDirFound) { // Chỉ xóa nếu thư mục tồn tại
                 await fs.unlink(fileRecord.filePath); // filePath đã được lưu là đường dẫn tuyệt đối
                 console.log(`[DỌN DẸP] Đã xóa file hết hạn: ${fileRecord.filePath}`);
            }
        } catch (err) {
            if (err.code !== 'ENOENT') { // Bỏ qua lỗi nếu file không tồn tại
                console.error(`[DỌN DẸP] Lỗi khi xóa file ${fileRecord.filePath}:`, err);
            }
        }
    }
    createdM3u8Files = filesToKeep;

    // Cách tiếp cận tốt hơn: Quét thư mục và xóa file dựa trên thời gian sửa đổi
    // Điều này không phụ thuộc vào `createdM3u8Files` và hoạt động tốt hơn.
    if (m3u8StorageDirFound) {
        try {
            const filesInDir = await fs.readdir(m3u8StoragePath);
            let deletedCountByScan = 0;
            for (const fileName of filesInDir) {
                if (!fileName.endsWith('.m3u8')) continue; // Chỉ xử lý file .m3u8

                const filePathInDir = path.join(m3u8StoragePath, fileName);
                try {
                    const stats = await fs.stat(filePathInDir);
                    if ((now - stats.mtimeMs) > M3U8_FILE_LIFETIME_MS) {
                        await fs.unlink(filePathInDir);
                        console.log(`[DỌN DẸP - QUÉT THƯ MỤC] Đã xóa file hết hạn: ${filePathInDir}`);
                        deletedCountByScan++;
                    }
                } catch (statErr) {
                    if (statErr.code !== 'ENOENT') {
                         console.error(`[DỌN DẸP - QUÉT THƯ MỤC] Lỗi khi lấy thông tin hoặc xóa file ${filePathInDir}:`, statErr);
                    }
                }
            }
            if (deletedCountByScan > 0) {
                 console.log(`[DỌN DẸP - QUÉT THƯ MỤC] Hoàn tất. Đã xóa ${deletedCountByScan} file.`);
            }
        } catch (readDirErr) {
            console.error(`[DỌN DẸP - QUÉT THƯ MỤC] Lỗi khi đọc thư mục ${m3u8StoragePath}:`, readDirErr);
        }
    }


    if (filesToDelete.length > 0 || (m3u8StorageDirFound && /* có file nào được quét và xoá không? */ true) ) {
        // Log này có thể cần điều chỉnh để phản ánh đúng số file đã xóa từ cả hai cơ chế
    } else {
        console.log('[DỌN DẸP] Không có file cũ nào (theo danh sách trong bộ nhớ) để xóa.');
    }
     console.log('[DỌN DẸP] Kết thúc kiểm tra.');
}

// Chạy dọn dẹp định kỳ. Ví dụ: mỗi giờ một lần.
// Để đảm bảo xóa file đúng 12 tiếng, bạn nên dùng `node-cron`.
// setInterval(cleanupOldFiles, 60 * 60 * 1000); // 1 giờ
// cleanupOldFiles(); // Chạy một lần khi server khởi động (nếu muốn)

router.get('/link/:base64data', async (req, res) => {
    const base64EncodedJson = req.params.base64data;
    console.log(`\n--- Bắt đầu xử lý yêu cầu cho /link/${base64EncodedJson.substring(0, 30)}... ---`);

    // Gọi hàm dọn dẹp (có thể chạy ngẫu nhiên hoặc theo một logic nào đó để không làm chậm request)
    // Ví dụ: chạy 5% số request để kiểm tra và dọn dẹp
    if (Math.random() < 0.05) {
        cleanupOldFiles().catch(err => console.error("[LỖI NỀN] Dọn dẹp tự động thất bại:", err));
    }

    if (!base64EncodedJson) {
        console.log("[LỖI] Thiếu dữ liệu Base64.");
        return res.status(400).json({ error: "Missing Base64 data in URL parameter." });
    }

    try {
        // Bước 1: Giải mã Base64 -> chuỗi JSON (GIỮ NGUYÊN)
        let jsonStringFromBase64;
        try {
            jsonStringFromBase64 = Buffer.from(base64EncodedJson, 'base64').toString('utf8');
            console.log("[OK] Bước 1: Giải mã Base64 thành công.");
        } catch (bufferError) {
            console.error("[LỖI] Bước 1: Lỗi giải mã Base64:", bufferError);
            return res.status(400).json({ error: "Invalid Base64 data provided." });
        }

        // Bước 2a: Tự parse chuỗi JSON bằng formatter để lấy đối tượng CipherParams (GIỮ NGUYÊN)
        let cipherParams;
        try {
            console.log("[...] Bước 2a: Đang parse input bằng formatter...");
            cipherParams = CryptoJSAesJson.parse(jsonStringFromBase64);
            console.log("[OK] Bước 2a: Parse input bằng formatter thành công.");
        } catch (formatParseError) {
            console.error("[LỖI] Bước 2a: Lỗi khi parse input bằng formatter:", formatParseError);
            return res.status(500).json({ error: `Failed to parse input using custom format: ${formatParseError.message}` });
        }

        // Bước 2b: Giải mã AES (GIỮ NGUYÊN)
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
        console.log(`[OK] Bước 2b: Giải mã AES thành công.`);

        // Bước 3: Parse JSON string -> Master Playlist URL (Link 1) (GIỮ NGUYÊN)
        let masterPlaylistUrl;
        try {
            masterPlaylistUrl = JSON.parse(decryptedJsonString);
            if (typeof masterPlaylistUrl !== 'string' || !masterPlaylistUrl.startsWith('http')) {
                throw new Error('Dữ liệu giải mã không phải là chuỗi URL hợp lệ.');
            }
            console.log(`[OK] Bước 3: Parse JSON thành công. Master Playlist URL: ${masterPlaylistUrl}`);
        } catch (parseError) {
            if (typeof decryptedJsonString === 'string' && decryptedJsonString.startsWith('http')) {
                console.warn(`[WARN] Bước 3: Không parse được JSON, dùng chuỗi giải mã gốc làm URL master: ${decryptedJsonString}`);
                masterPlaylistUrl = decryptedJsonString;
            } else {
                console.error("[LỖI] Bước 3: Dữ liệu giải mã không thể diễn giải thành URL:", parseError.message);
                return res.status(500).json({ error: "Decrypted data could not be interpreted as a valid URL." });
            }
        }

        // Bước 4: Fetch the content of the Master Playlist URL (GIỮ NGUYÊN)
        let m3u8Content;
        try {
            console.log(`[...] Bước 4: Đang tải master playlist từ: ${masterPlaylistUrl}`);
            const response = await axios.get(masterPlaylistUrl, {
                timeout: 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Linux; Android 14; SM-S711B Build/UP1A.231005.007) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.7049.111 Mobile Safari/537.36',
                    'Referer': 'https://anime47.lat/' // Giữ nguyên hoặc bạn có thể muốn thay đổi
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
            console.log("[OK] Bước 4: Đã tải xong nội dung M3U8 gốc.");
            // console.log("--- Nội dung M3U8 gốc (vài dòng đầu) ---");
            // console.log(m3u8Content.split(/[\r\n]+/).slice(0, 8).join('\n'));
            // console.log("--- Kết thúc nội dung M3U8 gốc ---");
        } catch (fetchError) {
            console.error(`[LỖI] Bước 4: Lỗi khi tải master playlist (${masterPlaylistUrl}):`, fetchError.response?.status, fetchError.message);
            return res.status(500).json({
                error: `Failed to fetch master playlist content from ${masterPlaylistUrl}`,
                details: fetchError.message
            });
        }

        // --- LOGIC MỚI BẮT ĐẦU TỪ ĐÂY ---

        // Bước 5: Chỉnh sửa nội dung M3U8 - Gắn thêm base URL vào các đường dẫn segment tương đối
        console.log("[...] Bước 5: Đang chỉnh sửa nội dung M3U8...");
        let modifiedM3u8Content;
        try {
            const lines = m3u8Content.split(/[\r\n]+/);
            const modifiedLines = lines.map(line => {
                const trimmedLine = line.trim();
                if (trimmedLine && !trimmedLine.startsWith('#') && trimmedLine.startsWith('/')) {
                    // Chỉ thêm vào nếu là đường dẫn tương đối bắt đầu bằng '/'
                    return M3U8_BASE_URL_TO_PREPEND + trimmedLine;
                }
                return line; // Giữ nguyên các dòng khác (comment, URL tuyệt đối, directives)
            });
            modifiedM3u8Content = modifiedLines.join('\n');
            console.log("[OK] Bước 5: Đã chỉnh sửa nội dung M3U8.");
            // console.log("--- Nội dung M3U8 đã chỉnh sửa (vài dòng đầu) ---");
            // console.log(modifiedM3u8Content.split('\n').slice(0, 10).join('\n'));
            // console.log("--- Kết thúc nội dung M3U8 đã chỉnh sửa ---");
        } catch (modifyError) {
            console.error("[LỖI] Bước 5: Lỗi khi chỉnh sửa nội dung M3U8:", modifyError);
            return res.status(500).json({ error: "Failed to modify M3U8 content.", details: modifyError.message });
        }

        // Bước 6: Lưu nội dung M3U8 đã chỉnh sửa vào file và tạo URL truy cập
        let fileUrl;
        let generatedFilePath; // Lưu đường dẫn file để thêm vào createdM3u8Files
        console.log("[...] Bước 6: Đang lưu file M3U8 đã chỉnh sửa...");
        try {
            // Đường dẫn đến thư mục lưu trữ file M3U8 (trong 'public')
            // __dirname là thư mục 'routes', '..' để lên thư mục gốc của dự án
            const m3u8StorageDir = path.join(__dirname, '..', 'public', M3U8_STORAGE_DIR_NAME);
            await fs.mkdir(m3u8StorageDir, { recursive: true }); // Đảm bảo thư mục tồn tại

            const filename = `${uuidv4()}.m3u8`; // Tạo tên file duy nhất
            generatedFilePath = path.join(m3u8StorageDir, filename);

            await fs.writeFile(generatedFilePath, modifiedM3u8Content);
            console.log(`[OK] Bước 6a: Đã lưu file M3U8 tại: ${generatedFilePath}`);

            // Thêm thông tin file vào danh sách để dọn dẹp (cơ chế cơ bản)
            createdM3u8Files.push({ filePath: generatedFilePath, creationTime: Date.now() });

            // Tạo URL để client có thể truy cập file
            // Giả định rằng thư mục 'public' được phục vụ tĩnh bởi Express ở gốc server
            // và các file trong 'public/generated_m3u8s/' sẽ truy cập được qua '/generated_m3u8s/'
            fileUrl = `${req.protocol}://${req.get('host')}/${M3U8_STORAGE_DIR_NAME}/${filename}`;
            console.log(`[OK] Bước 6b: URL của file M3U8 đã tạo: ${fileUrl}`);

        } catch (saveError) {
            console.error("[LỖI] Bước 6: Lỗi khi lưu file M3U8 hoặc tạo URL:", saveError);
            return res.status(500).json({ error: "Failed to save M3U8 file or create its URL.", details: saveError.message });
        }

        // Bước 7: Gửi phản hồi JSON với URL của file M3U8 đã chỉnh sửa
        console.log("[OK] Bước 7: Gửi phản hồi JSON với URL của M3U8 đã chỉnh sửa.");
        res.status(200).json({ modifiedM3u8Url: fileUrl });

    } catch (error) {
        console.error(`[LỖI TỔNG QUÁT] Lỗi khi xử lý /link/${base64EncodedJson.substring(0,30)}...:`, error);
        res.status(500).json({ error: `Server error: ${error.message}`, details: error.stack });
    }
});

module.exports = router;

// Ghi chú về việc dọn dẹp file (File Cleanup):
// Chức năng `cleanupOldFiles` và `createdM3u8Files` ở trên là một giải pháp cơ bản,
// hoạt động tốt nhất cho một server instance duy nhất và việc dọn dẹp có thể không chính xác hoàn toàn 12 giờ.
// Để có một hệ thống dọn dẹp file mạnh mẽ và đáng tin cậy:
// 1. Sử dụng một thư viện lập lịch công việc như `node-cron`.
//    Ví dụ cài đặt cron job chạy mỗi giờ để quét thư mục `M3U8_STORAGE_DIR_NAME`:
//    ```javascript
//    // Trong file chính của server (app.js)
//    const cron = require('node-cron');
//    const fs = require('fs').promises;
//    const path = require('path');
//    const M3U8_STORAGE_DIR_NAME_CRON = 'generated_m3u8s'; // Phải giống với cấu hình
//    const M3U8_FILE_LIFETIME_MS_CRON = 12 * 60 * 60 * 1000;
//
//    cron.schedule('0 * * * *', async () => { // Chạy vào phút thứ 0 của mỗi giờ
//        console.log('[CRON JOB] Bắt đầu dọn dẹp file M3U8 cũ...');
//        const m3u8Dir = path.join(__dirname, 'public', M3U8_STORAGE_DIR_NAME_CRON);
//        try {
//            const files = await fs.readdir(m3u8Dir);
//            const now = Date.now();
//            for (const file of files) {
//                if (file.endsWith('.m3u8')) {
//                    const filePath = path.join(m3u8Dir, file);
//                    const stats = await fs.stat(filePath);
//                    if ((now - stats.mtimeMs) > M3U8_FILE_LIFETIME_MS_CRON) {
//                        await fs.unlink(filePath);
//                        console.log(`[CRON JOB] Đã xóa file hết hạn: ${filePath}`);
//                    }
//                }
//            }
//        } catch (err) {
//            if (err.code === 'ENOENT') {
//                 console.log(`[CRON JOB] Thư mục ${m3u8Dir} không tồn tại, không có gì để dọn.`);
//            } else {
//                 console.error('[CRON JOB] Lỗi khi dọn dẹp file M3U8:', err);
//            }
//        }
//        console.log('[CRON JOB] Kết thúc dọn dẹp.');
//    });
//    ```
// 2. Đảm bảo thư mục `public/generated_m3u8s` được tạo và có quyền ghi cho user chạy Node.js.
//    Hàm `fs.mkdir(..., { recursive: true })` sẽ tự tạo thư mục nếu chưa có.
