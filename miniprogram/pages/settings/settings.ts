import { API_ENDPOINTS, DEFAULT_LIMITS, PAID_DAILY_LIMITS } from '../../config'
import { request } from '../../utils/request'

interface InviteLink {
  id: number;
  code: string;
  used_by: string | null;
  used_at: string | null;
  created_at: string;
}

interface ActivationLink {
  id: number;
  code: string;
  duration_days: number;
  max_invite_links: number;
  used_by: string | null;
  used_at: string | null;
  created_at: string;
}

Component({
  data: {
    openid: '',
    isAdmin: false,
    isPaid: false,
    isSponsored: false,
    paidUntil: '',
    maxInviteLinks: 0,
    dataQuota: DEFAULT_LIMITS.DATA_ENTRIES,
    ocrQuota: DEFAULT_LIMITS.OCR_TIMES,
    quotaIsDaily: false,
    defaults: DEFAULT_LIMITS,
    paidDefaults: PAID_DAILY_LIMITS,

    // Invite links
    inviteLinks: [] as InviteLink[],
    inviteUsed: 0,
    inviteLimit: 0,

    // Feedback
    types: ['功能需求', '用户反馈'],
    selectedType: 0,
    selectedTypeDisplay: '功能需求',
    content: '',
    contact: '',

    // Admin: generate activation links
    adminDays: 365,
    adminInviteLinks: 5,
    adminCount: 1,
    generatedCodes: [] as string[],
    allActivationLinks: [] as ActivationLink[],

    // Activation code input (for manual entry / fallback)
    activationCode: '',
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
        const isPaid = res.is_paid || false
        const isSponsored = res.is_sponsored || false
        this.setData({
          isPaid,
          isSponsored,
          isAdmin: res.is_admin || false,
          paidUntil: res.paid_until ? new Date(res.paid_until).toLocaleDateString() : '',
          maxInviteLinks: res.max_invite_links || 0,
          dataQuota: res.data_quota || DEFAULT_LIMITS.DATA_ENTRIES,
          ocrQuota: res.ocr_quota || DEFAULT_LIMITS.OCR_TIMES,
          quotaIsDaily: res.quota_is_daily || false,
        })
        // Load invite links if paid user
        if (isPaid) {
          this.loadInviteLinks()
        }
        // Load all activation links if admin
        if (res.is_admin) {
          this.loadActivationLinks()
        }
      } catch (err) {
        console.error('Failed to load user info:', err)
      }
    },

    async loadInviteLinks() {
      try {
        const res: any = await request({ url: API_ENDPOINTS.INVITE_LIST, method: 'GET' })
        this.setData({
          inviteLinks: res.data || [],
          inviteUsed: res.used || 0,
          inviteLimit: res.limit || 0,
        })
      } catch (err) {
        console.error('Failed to load invite links:', err)
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

    copyCode(e: any) {
      const code = e.currentTarget.dataset.code
      if (code) {
        wx.setClipboardData({
          data: code,
          success: () => wx.showToast({ title: '已复制', icon: 'success' })
        })
      }
    },

    copyInviteLink(e: any) {
      const code = e.currentTarget.dataset.code
      if (code) {
        // Generate the mini program share path
        const path = `/pages/record/record?invite=${code}`
        wx.setClipboardData({
          data: path,
          success: () => wx.showToast({ title: '邀请链接已复制', icon: 'success' })
        })
      }
    },

    async onCreateInviteLink() {
      try {
        const res: any = await request({ url: API_ENDPOINTS.INVITE_CREATE, method: 'POST' })
        wx.showToast({ title: res.message || '创建成功', icon: 'success' })
        this.loadInviteLinks()
      } catch (err: any) {
        wx.showToast({ title: err?.data?.error || '创建失败', icon: 'none' })
      }
    },

    onShareInviteLink(e: any) {
      // This is handled by onShareAppMessage
      const code = e.currentTarget.dataset.code
      if (code) {
        this.setData({ _shareInviteCode: code } as any)
      }
    },

    onShareAppMessage() {
      const code = (this.data as any)._shareInviteCode
      if (code) {
        // Clear after use
        this.setData({ _shareInviteCode: '' } as any)
        return {
          title: '安压宝 - 邀请你使用血压健康管理',
          path: `/pages/record/record?invite=${code}`,
        }
      }
      return {
        title: '安压宝 - 血压健康管理',
        path: `/pages/record/record`,
      }
    },

    // Activation code manual entry
    onActivationCodeInput(e: any) {
      this.setData({ activationCode: e.detail.value })
    },

    async onSubmitActivationCode() {
      const code = this.data.activationCode
      if (!code) {
        wx.showToast({ title: '请输入激活码', icon: 'none' })
        return
      }
      try {
        const res: any = await request({ url: API_ENDPOINTS.AUTHORIZE, method: 'POST', data: { code } })
        wx.showToast({ title: res.message || '激活成功' })
        this.setData({ activationCode: '' })
        this.loadUserInfo()
      } catch (err: any) {
        wx.showToast({ title: err?.data?.error || '激活失败', icon: 'none' })
      }
    },

    // Feedback
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
      if (!this.data.isPaid && !this.data.isSponsored) {
        wx.showToast({ title: '仅付费用户可提交', icon: 'none' })
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

    // Admin
    onAdminDaysInput(e: any) {
      this.setData({ adminDays: parseInt(e.detail.value) || 365 })
    },
    onAdminInviteLinksInput(e: any) {
      this.setData({ adminInviteLinks: parseInt(e.detail.value) || 5 })
    },
    onAdminCountInput(e: any) {
      this.setData({ adminCount: parseInt(e.detail.value) || 1 })
    },
    async loadActivationLinks() {
      try {
        const res: any = await request({ url: API_ENDPOINTS.ADMIN_ACTIVATION_LINKS, method: 'GET' })
        const links = (res.data || []).slice(0, 30)
        this.setData({ allActivationLinks: links })
      } catch (err) {
        console.error('Failed to load activation links:', err)
      }
    },

    async onGenerateActivationLinks() {
      const payload = {
        duration_days: this.data.adminDays,
        max_invite_links: this.data.adminInviteLinks,
        count: this.data.adminCount,
      }
      try {
        const res: any = await request({ url: API_ENDPOINTS.ADMIN_ACTIVATION_LINKS, method: 'POST', data: payload })
        wx.showToast({ title: `成功生成 ${res.count} 个激活链接`, icon: 'success' })
        this.setData({ generatedCodes: res.codes || [] })
        // Reload full list
        this.loadActivationLinks()
      } catch (err: any) {
        wx.showToast({ title: err?.data?.error || '生成失败', icon: 'none' })
      }
    },

    copyActivationLink(e: any) {
      const code = e.currentTarget.dataset.code
      if (code) {
        // Generate mini program link for sharing
        const link = `#小程序://安压宝/pages/record/record?activate=${code}`
        wx.setClipboardData({
          data: link,
          success: () => wx.showToast({ title: '链接已复制', icon: 'success' })
        })
      }
    },
  }
})
