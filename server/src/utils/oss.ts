import OSS from 'ali-oss';
import config from '../config';
import path from 'path';
import crypto from 'crypto';

let client: OSS | null = null;

function getClient(): OSS {
  if (!client) {
    const { region, accessKeyId, accessKeySecret, bucket } = config.oss;
    if (!accessKeyId || !accessKeySecret || !bucket) {
      throw new Error('OSS configuration is missing');
    }
    client = new OSS({
      region,
      accessKeyId,
      accessKeySecret,
      bucket,
      secure: true // Use HTTPS
    });
  }
  return client;
}

export async function uploadImageToOSS(buffer: Buffer, originalFilename: string): Promise<string> {
  try {
    const ossClient = getClient();
    
    // Generate a unique filename: ocr/{YYYY}/{MM}/{DD}/{random}_{timestamp}.ext
    const now = new Date();
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    
    const ext = path.extname(originalFilename) || '.jpg';
    const random = crypto.randomBytes(4).toString('hex');
    const timestamp = now.getTime();
    
    const objectName = `ocr/${year}/${month}/${day}/${timestamp}_${random}${ext}`;
    
    const result = await ossClient.put(objectName, buffer);
    
    // Return the path (object name) or full URL depending on your need.
    // Returning object name is safer if you want to sign URLs later, 
    // but for now let's return the object name to store in DB.
    return objectName;
  } catch (error) {
    console.error('OSS Upload Error:', error);
    throw error;
  }
}
