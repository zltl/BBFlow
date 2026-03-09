/// <reference path="./types/index.d.ts" />

interface IAppOption {
  globalData: {
    userInfo?: WechatMiniprogram.UserInfo,
  }
  userInfoReadyCallback?: WechatMiniprogram.GetUserInfoSuccessCallback,
  processPendingActions(): void,
}

declare namespace WechatMiniprogram {
  interface Wx {
    shareFileMessage(opts: {
      filePath: string;
      fileName?: string;
      success?: (res: any) => void;
      fail?: (err: any) => void;
      complete?: () => void;
    }): void;
  }
}