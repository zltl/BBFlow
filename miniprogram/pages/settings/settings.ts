import { API_ENDPOINTS, DEFAULT_LIMITS } from '../../config'
import { request } from '../../utils/request'

Component({
  data: {
    openid: '',
    code: '',
    authorized: false,
    isAdmin: false,
    types: ['功能需求', '用户反馈'],
    selectedType: 0,
    selectedTypeDisplay: '功能需求',
    content: '',
    contact: '',
    defaults: DEFAULT_LIMITS,
    // 管理员生成授权码
    adminDataQuota: 10000,
    adminOcrQuota: 10000,
    adminDays: 365,
    adminCount: 1,
    generatedCodes: [] as string[],
    // 推荐码
    referralCode: '',
    referrerCode: '',
    hasReferrer: false,
  },
  lifetimes: {
    attached() {
      const openid = wx.getStorageSync('openid') || ''
      this.setData({ openid })
      this.loadUserInfo()
    }
  },
  methods: {
    async loadUserInfo() {
      try {
        const res: any = await request({ url: API_ENDPOINTS.USER_INFO, method: 'GET' })
        this.setData({
          authorized: res.authorized || false,
          isAdmin: res.is_admin || false,
          referralCode: res.referral_code || '',
          hasReferrer: !!(res.referrer_id),
        })
      } catch (err) {
        console.error('Failed to load user info:', err)
      }
    },
    copyOpenid() {
      if (this.data.openid) {
        wx.setClipboardData({
          data: this.data.openid,
          success: () => wx.showToast({ title: '已复制', icon: 'success' })
        })
      }
    },
    copyReferralCode() {
      if (this.data.referralCode) {
        wx.setClipboardData({
          data: this.data.referralCode,
          success: () => wx.showToast({ title: '推荐码已复制', icon: 'success' })
        })
      }
    },
    copyCode(e: any) {
      const code = e.currentTarget.dataset.code
      if (code) {
        wx.setClipboardData({
          data: code,
          success: () => wx.showToast({ title: '已复制', icon: 'success' })
        })
      }
    },
    onReferrerCodeInput(e: any) {
      this.setData({ referrerCode: e.detail.value })
    },
    async onBindReferrer() {
      const referralCode = this.data.referrerCode
      if (!referralCode) {
        wx.showToast({ title: '请输入推荐码', icon: 'none' })
        return
      }
      try {
        const res: any = await request({ url: API_ENDPOINTS.BIND_REFERRER, method: 'POST', data: { referral_code: referralCode } })
        wx.showToast({ title: res.message || '绑定成功' })
        this.setData({ hasReferrer: true, referrerCode: '' })
      } catch (err: any) {
        wx.showToast({ title: err?.data?.error || '绑定失败', icon: 'none' })
      }
    },
    onShareAppMessage() {
      return {
        title: '安压宝 - 血压健康管理',
        path: `/pages/record/record?referral=${this.data.referralCode}`,
      }
    },
    onCodeInput(e: any) {
      this.setData({ code: e.detail.value })
    },
    async onSubmitCode() {
      const code = this.data.code
      if (!code) {
        wx.showToast({ title: '请输入授权码', icon: 'none' })
        return
      }
      try {
        const res: any = await request({ url: API_ENDPOINTS.AUTHORIZE, method: 'POST', data: { code } })
        wx.showToast({ title: res.message || '授权成功' })
        this.setData({ authorized: true })
        wx.setStorageSync('authorized', true)
      } catch (err: any) {
        wx.showToast({ title: err?.data?.error || '授权失败', icon: 'none' })
      }
    },
    onTypeChange(e: any) {
      const i = e.detail.value
      this.setData({ selectedType: i, selectedTypeDisplay: this.data.types[i] })
    },
    onContentInput(e: any) {
      this.setData({ content: e.detail.value })
    },
    onContactInput(e: any) {
      this.setData({ contact: e.detail.value })
    },
    async onSubmitFeedback() {
      if (!this.data.authorized) {
        wx.showToast({ title: '仅已授权用户可提交', icon: 'none' })
        return
      }
      if (!this.data.content) {
        wx.showToast({ title: '请填写内容', icon: 'none' })
        return
      }
      const payload = {
        type: this.data.selectedType === 0 ? 'feature' : 'feedback',
        content: this.data.content,
        contact: this.data.contact,
      }
      try {
        const res: any = await request({ url: API_ENDPOINTS.FEEDBACK, method: 'POST', data: payload })
        wx.showToast({ title: res.message || '提交成功' })
        this.setData({ content: '', contact: '' })
      } catch (err: any) {
        wx.showToast({ title: err?.data?.error || '提交失败', icon: 'none' })
      }
    },
    // 管理员相关
    onAdminDataQuotaInput(e: any) {
      this.setData({ adminDataQuota: parseInt(e.detail.value) || 10000 })
    },
    onAdminOcrQuotaInput(e: any) {
      this.setData({ adminOcrQuota: parseInt(e.detail.value) || 10000 })
    },
    onAdminDaysInput(e: any) {
      this.setData({ adminDays: parseInt(e.detail.value) || 365 })
    },
    onAdminCountInput(e: any) {
      this.setData({ adminCount: parseInt(e.detail.value) || 1 })
    },
    async onGenerateCodes() {
      const payload = {
        data_quota: this.data.adminDataQuota,
        ocr_quota: this.data.adminOcrQuota,
        duration_days: this.data.adminDays,
        count: this.data.adminCount,
      }
      try {
        const res: any = await request({ url: API_ENDPOINTS.ADMIN_AUTH_CODES, method: 'POST', data: payload })
        wx.showToast({ title: `成功生成 ${res.count} 个授权码`, icon: 'success' })
        this.setData({ generatedCodes: res.codes || [] })
      } catch (err: any) {
        wx.showToast({ title: err?.data?.error || '生成失败', icon: 'none' })
      }
    }
  }
})
