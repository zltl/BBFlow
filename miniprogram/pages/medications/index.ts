import { API_ENDPOINTS } from '../../config';
import { request } from '../../utils/request';

interface MedicationItem {
  id: number;
  name: string;
  dosage: string;
  frequency: string;
  reminder_time: string;
  is_active: boolean;
  created_at: string;
  adherenceRateText?: string;
  takenCount?: number;
  skippedCount?: number;
}

interface AdherenceItem {
  medication_id: number;
  name: string;
  taken_count: number;
  skipped_count: number;
  total_logs: number;
  adherence_rate: number;
}

Page({
  data: {
    isLoading: false,
    formVisible: false,
    editingId: 0,
    name: '',
    dosage: '',
    frequency: '',
    reminderTime: '08:00',
    medications: [] as MedicationItem[],
    adherence: [] as AdherenceItem[],
    averageAdherence: 0,
  },

  onShow() {
    this.loadData();
  },

  async loadData() {
    this.setData({ isLoading: true });
    try {
      const [medRes, adherenceRes] = await Promise.all([
        request<{ data: MedicationItem[] }>({ url: API_ENDPOINTS.MEDICATIONS, method: 'GET', showError: false }),
        request<{ data: AdherenceItem[] }>({ url: `${API_ENDPOINTS.MEDICATION_ADHERENCE}?days=30`, method: 'GET', showError: false }),
      ]);

      const adherence = adherenceRes.data || [];
      const averageAdherence = adherence.length > 0
        ? Math.round(adherence.reduce((sum, item) => sum + item.adherence_rate, 0) / adherence.length)
        : 0;
      const adherenceByMedication = new Map(adherence.map((item) => [item.medication_id, item]));

      this.setData({
        medications: (medRes.data || []).map((item) => {
          const adherenceItem = adherenceByMedication.get(item.id);
          return {
            ...item,
            adherenceRateText: adherenceItem ? `${Math.round(adherenceItem.adherence_rate)}%` : '暂无记录',
            takenCount: adherenceItem?.taken_count || 0,
            skippedCount: adherenceItem?.skipped_count || 0,
          };
        }),
        adherence,
        averageAdherence,
      });
    } catch (error) {
      console.error('Failed to load medications', error);
    } finally {
      this.setData({ isLoading: false });
    }
  },

  showCreateForm() {
    this.setData({
      formVisible: true,
      editingId: 0,
      name: '',
      dosage: '',
      frequency: '',
      reminderTime: '08:00',
    });
  },

  hideForm() {
    this.setData({ formVisible: false, editingId: 0 });
  },

  editMedication(e: WechatMiniprogram.TouchEvent) {
    const item = e.currentTarget.dataset.item as MedicationItem;
    if (!item) return;

    this.setData({
      formVisible: true,
      editingId: item.id,
      name: item.name,
      dosage: item.dosage,
      frequency: item.frequency,
      reminderTime: item.reminder_time || '08:00',
    });
  },

  onNameInput(e: WechatMiniprogram.Input) {
    this.setData({ name: e.detail.value });
  },

  onDosageInput(e: WechatMiniprogram.Input) {
    this.setData({ dosage: e.detail.value });
  },

  onFrequencyInput(e: WechatMiniprogram.Input) {
    this.setData({ frequency: e.detail.value });
  },

  onReminderTimeChange(e: WechatMiniprogram.PickerChange) {
    this.setData({ reminderTime: e.detail.value as string });
  },

  async saveMedication() {
    if (!this.data.name.trim()) {
      wx.showToast({ title: '请输入药物名称', icon: 'none' });
      return;
    }

    const payload = {
      name: this.data.name.trim(),
      dosage: this.data.dosage.trim(),
      frequency: this.data.frequency.trim(),
      reminderTime: this.data.reminderTime,
    };

    try {
      if (this.data.editingId) {
        await request({
          url: `${API_ENDPOINTS.MEDICATIONS}/${this.data.editingId}`,
          method: 'PUT',
          data: payload,
        });
      } else {
        await request({
          url: API_ENDPOINTS.MEDICATIONS,
          method: 'POST',
          data: payload,
        });
      }

      wx.showToast({ title: this.data.editingId ? '已更新' : '已添加', icon: 'success' });
      this.hideForm();
      this.loadData();
    } catch (error) {
      console.error('Failed to save medication', error);
    }
  },

  async logMedication(e: WechatMiniprogram.TouchEvent) {
    const medicationId = Number(e.currentTarget.dataset.id);
    const skipped = Boolean(e.currentTarget.dataset.skipped);
    if (!medicationId) return;

    try {
      await request({
        url: API_ENDPOINTS.MEDICATION_LOG,
        method: 'POST',
        data: {
          medicationId,
          skipped,
          note: skipped ? '用户手动标记跳过' : '用户手动打卡',
        },
      });
      wx.showToast({ title: skipped ? '已记录跳过' : '服药已打卡', icon: 'success' });
      this.loadData();
    } catch (error) {
      console.error('Failed to log medication', error);
    }
  },

  stopMedication(e: WechatMiniprogram.TouchEvent) {
    const medicationId = Number(e.currentTarget.dataset.id);
    if (!medicationId) return;

    wx.showModal({
      title: '停用药物',
      content: '停用后不会删除历史打卡记录，确认继续吗？',
      confirmColor: '#ff4d4f',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await request({
            url: `${API_ENDPOINTS.MEDICATIONS}/${medicationId}`,
            method: 'DELETE',
          });
          wx.showToast({ title: '已停用', icon: 'success' });
          this.loadData();
        } catch (error) {
          console.error('Failed to stop medication', error);
        }
      },
    });
  },
});
