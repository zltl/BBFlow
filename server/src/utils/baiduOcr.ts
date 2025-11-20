import axios from 'axios';
import config from '../config';

let cachedToken: string | null = null;
let tokenExpiresAt: number = 0;

export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt) {
    return cachedToken;
  }

  const { apiKey, secretKey } = config.baidu;
  if (!apiKey || !secretKey) {
    throw new Error('Baidu API Key or Secret Key not configured');
  }

  const url = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${apiKey}&client_secret=${secretKey}`;
  
  try {
    const response = await axios.post(url);
    const { access_token, expires_in } = response.data;
    
    if (!access_token) {
      throw new Error('Failed to get access token from Baidu: ' + JSON.stringify(response.data));
    }

    cachedToken = access_token;
    // expires_in is in seconds, subtract 60s buffer
    tokenExpiresAt = now + (expires_in - 60) * 1000;
    
    return access_token;
  } catch (error) {
    console.error('Error getting Baidu access token:', error);
    throw error;
  }
}

export async function recognizeImage(imageBuffer: Buffer) {
  console.log('[BaiduOCR] Getting access token...');
  const token = await getAccessToken();
  console.log('[BaiduOCR] Access token retrieved.');

  // 使用仪器仪表盘读数识别
  const url = `https://aip.baidubce.com/rest/2.0/ocr/v1/meter?access_token=${token}`;
  
  // Convert buffer to base64
  const imageBase64 = imageBuffer.toString('base64');
  
  try {
    console.log('[BaiduOCR] Sending request to Baidu Meter OCR API...');
    // Baidu OCR expects form-urlencoded body
    const params = new URLSearchParams();
    params.append('image', imageBase64);
    // params.append('probability', 'true'); // Optional: return confidence
    // params.append('poly_location', 'true'); // Optional: return polygon location

    const response = await axios.post(url, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    if (response.data.error_code) {
      console.error('[BaiduOCR] API Error:', response.data);
      throw new Error(`Baidu OCR Error: ${response.data.error_msg}`);
    }

    console.log(`[BaiduOCR] Success. Found ${response.data.words_result ? response.data.words_result.length : 0} words.`);
    return response.data.words_result;
  } catch (error) {
    console.error('Error calling Baidu OCR:', error);
    throw error;
  }
}
