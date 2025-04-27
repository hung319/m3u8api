const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const router = express.Router();

// Route chính
router.get('/get-m3u8', async (req, res) => {
  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).send('Thiếu link URL rồi đó Yuu Onii-chan~');
    }

    // Dùng regex để tách filmid và epid
    const match = url.match(/-(\d+)\.(\d+)\.html/);
    if (!match) {
      return res.status(400).send('Link không hợp lệ, Yuu Onii-chan ơi~');
    }

    const filmid = match[1];
    const epid = match[2];

    const apiUrl = `https://animet.org/ajax/episode/info`;
    const response = await axios.post(apiUrl, {
      filmid: filmid,
      epid: epid
    });

    const html = response.data.html;
    const $ = cheerio.load(html);

    let m3u8 = $('video source').attr('src');

    if (m3u8) {
      res.send(m3u8);
    } else {
      res.send('Không tìm thấy link m3u8... Gomen Yuu Onii-chan~');
    }

  } catch (error) {
    console.error(error);
    res.status(500).send('Có lỗi xảy ra rồi... Mahiro xin lỗi Yuu Onii-chan~');
  }
});

module.exports = router;
