import { API_ENDPOINTS } from '../../config';
import { request } from '../../utils/request';

interface TicketMessage {
  id: number;
  sender_type: 'user' | 'admin';
  content: string;
  created_at: string;
  createdAtText?: string;
}

Page({
  data: {
    ticketId: 0,
    subject: '',
    status: '',
    isLoading: false,
    replyContent: '',
    messages: [] as TicketMessage[],
  },

  onLoad(options: Record<string, string>) {
    this.setData({
      ticketId: Number(options.id || 0),
      subject: decodeURIComponent(options.subject || ''),
      status: options.status || '',
    });
  },

  onShow() {
    if (this.data.ticketId) {
      this.loadMessages();
    }
  },

  async loadMessages() {
    this.setData({ isLoading: true });
    try {
      const res = await request<{ data: TicketMessage[] }>({
        url: `${API_ENDPOINTS.TICKETS}/${this.data.ticketId}/messages`,
        method: 'GET',
        showError: false,
      });
      this.setData({
        messages: (res.data || []).map((item) => ({
          ...item,
          createdAtText: this.formatTime(item.created_at),
        })),
      });
    } catch (error) {
      console.error('Failed to load ticket messages', error);
    } finally {
      this.setData({ isLoading: false });
    }
  },

  onReplyInput(e: WechatMiniprogram.Input) {
    this.setData({ replyContent: e.detail.value });
  },

  async sendReply() {
    const content = this.data.replyContent.trim();
    if (!content) {
      wx.showToast({ title: '请输入回复内容', icon: 'none' });
      return;
    }

    try {
      await request({
        url: `${API_ENDPOINTS.TICKETS}/${this.data.ticketId}/reply`,
        method: 'POST',
        data: { content },
      });
      wx.showToast({ title: '回复已发送', icon: 'success' });
      this.setData({ replyContent: '' });
      this.loadMessages();
    } catch (error) {
      console.error('Failed to reply ticket', error);
    }
  },

  formatTime(value: string) {
    return new Date(value).toLocaleString();
  },
});
