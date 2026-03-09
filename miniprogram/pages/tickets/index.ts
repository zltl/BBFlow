import { API_ENDPOINTS } from '../../config';
import { request } from '../../utils/request';

interface TicketItem {
  id: number;
  subject: string;
  status: string;
  priority: string;
  created_at: string;
  updated_at: string;
  statusLabel?: string;
  updatedAtText?: string;
}

Page({
  data: {
    isLoading: false,
    subject: '',
    content: '',
    tickets: [] as TicketItem[],
  },

  onShow() {
    this.loadTickets();
  },

  async loadTickets() {
    this.setData({ isLoading: true });
    try {
      const res = await request<{ data: TicketItem[] }>({
        url: API_ENDPOINTS.TICKETS,
        method: 'GET',
        showError: false,
      });

      this.setData({
        tickets: (res.data || []).map((item) => ({
          ...item,
          statusLabel: item.status === 'closed' ? '已关闭' : '处理中',
          updatedAtText: this.formatTime(item.updated_at),
        })),
      });
    } catch (error) {
      console.error('Failed to load tickets', error);
    } finally {
      this.setData({ isLoading: false });
    }
  },

  onSubjectInput(e: WechatMiniprogram.Input) {
    this.setData({ subject: e.detail.value });
  },

  onContentInput(e: WechatMiniprogram.Input) {
    this.setData({ content: e.detail.value });
  },

  async createTicket() {
    const subject = this.data.subject.trim();
    const content = this.data.content.trim();
    if (!subject || !content) {
      wx.showToast({ title: '请填写主题和问题描述', icon: 'none' });
      return;
    }

    try {
      await request({
        url: API_ENDPOINTS.TICKETS,
        method: 'POST',
        data: { subject, content },
      });
      wx.showToast({ title: '工单已提交', icon: 'success' });
      this.setData({ subject: '', content: '' });
      this.loadTickets();
    } catch (error) {
      console.error('Failed to create ticket', error);
    }
  },

  openTicket(e: WechatMiniprogram.TouchEvent) {
    const item = e.currentTarget.dataset.item as TicketItem;
    if (!item) return;
    wx.navigateTo({
      url: `/pages/tickets/detail?id=${item.id}&subject=${encodeURIComponent(item.subject)}&status=${item.status}`,
    });
  },

  formatTime(value: string) {
    return new Date(value).toLocaleString();
  },
});
