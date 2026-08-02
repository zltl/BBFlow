/** Show upgrade guidance when quota is exceeded */
export function promptQuotaUpgrade(message?: string) {
  wx.showModal({
    title: '配额已用完',
    content: message || '今日/本月可用次数已用完。开通会员可获得更高 OCR 与记录配额。',
    confirmText: '去开通',
    cancelText: '知道了',
    success: (res) => {
      if (res.confirm) {
        wx.navigateTo({ url: '/pages/subscription/index' });
      }
    },
  });
}

export function isQuotaError(err: any): boolean {
  const msg = String(err?.message || err?.data?.message || err?.data?.error || '');
  return /配额|上限|quota/i.test(msg) || (err?.statusCode === 403 && /上限|配额/.test(msg));
}
