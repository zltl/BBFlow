import express, { Request, Response } from 'express';
import axios from 'axios';
import db from '../db';
import config from '../config';

const router = express.Router();

// 登录接口：接收 code，换取 openid
router.post('/login', async (req: Request, res: Response) => {
  const { code, userInfo } = req.body;

  console.log('----- Login Request Start -----');
  console.log('Received code:', code);
  console.log('Received userInfo:', userInfo ? JSON.stringify(userInfo) : 'undefined');

  if (!code) {
    console.log('Error: Missing code');
    return res.status(400).json({ error: 'Missing code' });
  }

  try {
    // 调用微信接口获取 openid
    const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${config.wx.appid}&secret=${config.wx.secret}&js_code=${code}&grant_type=authorization_code`;
    console.log('Requesting WeChat API:', url);
    
    const response = await axios.get(url);
    console.log('WeChat API Response:', JSON.stringify(response.data));
    
    if (response.data.errcode) {
      console.error('WeChat API Error:', response.data);
      return res.status(400).json({ error: 'WeChat API Error', details: response.data });
    }

    const { openid } = response.data;
    console.log('Login successful. OpenID:', openid);
    handleLoginSuccess(res, openid, userInfo);

  } catch (error) {
    console.error('Login Exception:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

function handleLoginSuccess(res: Response, openid: string, userInfo: any) {
  console.log(`Saving/Updating user in DB. OpenID: ${openid}`);
  if (userInfo) {
    console.log('User info to save:', JSON.stringify(userInfo));
  } else {
    console.log('No extra user info provided.');
  }

  // 更新或创建用户
  const query = `
    INSERT INTO users (openid, nickname, avatar_url) 
    VALUES ($1, $2, $3)
    ON CONFLICT (openid) DO UPDATE 
    SET nickname = EXCLUDED.nickname, avatar_url = EXCLUDED.avatar_url
  `;
  
  db.query(query, [openid, userInfo?.nickName, userInfo?.avatarUrl])
    .catch(err => console.error('Error saving user:', err));

  res.json({ 
    openid, 
    token: 'mock_token_' + openid, // 实际项目中应生成 JWT
    message: 'Login successful' 
  });
}

export default router;
