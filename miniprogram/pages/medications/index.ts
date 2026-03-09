import { API_ENDPOINTS } from '../../config';
import { request } from '../../utils/request';

interface MedicationGroup {
  category: string;
  items: string[];
}

const COMMON_HYPERTENSION_MEDICATION_GROUPS: MedicationGroup[] = [
  {
    category: 'ARB',
    items: ['缬沙坦', '氯沙坦', '厄贝沙坦', '替米沙坦', '奥美沙坦', '坎地沙坦', '阿利沙坦酯'],
  },
  {
    category: 'ACEI',
    items: ['培哚普利', '依那普利', '贝那普利', '福辛普利', '雷米普利', '卡托普利', '赖诺普利'],
  },
  {
    category: 'CCB',
    items: ['氨氯地平', '左旋氨氯地平', '硝苯地平控释片', '非洛地平', '乐卡地平', '拉西地平', '地尔硫卓', '维拉帕米'],
  },
  {
    category: '利尿剂',
    items: ['吲达帕胺', '氢氯噻嗪', '氯噻酮', '螺内酯', '呋塞米', '托拉塞米'],
  },
  {
    category: 'β 受体阻滞剂',
    items: ['美托洛尔', '比索洛尔', '阿替洛尔', '普萘洛尔', '卡维地洛'],
  },
  {
    category: '其他降压药',
    items: ['特拉唑嗪', '多沙唑嗪', '可乐定', '莫索尼定', '利血平'],
  },
  {
    category: '复方制剂',
    items: ['沙库巴曲缬沙坦', '氨氯地平贝那普利', '缬沙坦氨氯地平', '厄贝沙坦氢氯噻嗪', '替米沙坦氨氯地平', '奥美沙坦酯氨氯地平', '培哚普利吲达帕胺', '缬沙坦氢氯噻嗪'],
  },
];

const COMMON_DOSAGE_OPTIONS = ['2.5mg', '5mg', '10mg', '20mg', '25mg', '40mg', '50mg', '80mg', '100mg', '160mg', '半片', '1片'];

const COMMON_FREQUENCY_OPTIONS = ['每日1次', '每日2次', '每日早晨1次', '每日晚上1次', '每日早晚各1次', '睡前1次', '遵医嘱'];

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
    medicationGroups: COMMON_HYPERTENSION_MEDICATION_GROUPS,
    dosageOptions: COMMON_DOSAGE_OPTIONS,
    frequencyOptions: COMMON_FREQUENCY_OPTIONS,
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

  selectMedication(e: WechatMiniprogram.TouchEvent) {
    const name = e.currentTarget.dataset.name as string;
    if (!name) return;
    this.setData({ name });
  },

  onNameInput(e: WechatMiniprogram.Input) {
    this.setData({ name: e.detail.value });
  },

  onDosageInput(e: WechatMiniprogram.Input) {
    this.setData({ dosage: e.detail.value });
  },

  selectDosageOption(e: WechatMiniprogram.TouchEvent) {
    const dosage = e.currentTarget.dataset.value as string;
    if (!dosage) return;
    this.setData({ dosage });
  },

  onFrequencyInput(e: WechatMiniprogram.Input) {
    this.setData({ frequency: e.detail.value });
  },

  selectFrequencyOption(e: WechatMiniprogram.TouchEvent) {
    const frequency = e.currentTarget.dataset.value as string;
    if (!frequency) return;
    this.setData({ frequency });
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
