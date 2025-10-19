// uiShared.js
const RANK_COLORS = {
  S: {bg: 'bg-red-600', hover: 'hover:bg-red-700', text: 'text-red-600', hex: '#dc2626', label: 'S'},
  A: {bg: 'bg-yellow-600', hover: 'hover:bg-yellow-700', text: 'text-yellow-600', hex: '#ca8a04', label: 'A'},
  F: {bg: 'bg-indigo-600', hover: 'hover:bg-indigo-700', text: 'text-indigo-600', hex: '#4f46e5', label: 'F'},
};

const PROGRESS_CLASSES = {
  P0_60: 'progress-p0-60',
  P60_80: 'progress-p60-80',
  P80_100: 'progress-p80-100',
  TEXT_NEXT: 'progress-next-text',
  TEXT_POP: 'progress-pop-text',
  MAX_OVER_BLINK: 'progress-max-over-blink'
};

const FILTER_TO_DATA_RANK_MAP = { FATE: 'F', ALL: 'ALL', S: 'S', A: 'A'};

const DOM = {
  masterContainer: document.getElementById('master-mob-container'),
  colContainer: document.getElementById('column-container'),
  cols: [document.getElementById('column-1'), document.getElementById('column-2'), document.getElementById('column-3')],
  rankTabs: document.getElementById('rank-tabs'),
  areaFilterWrapper: document.getElementById('area-filter-wrapper'),
  areaFilterPanel: document.getElementById('area-filter-panel'),
  statusMessage: document.getElementById('status-message'),
  reportModal: document.getElementById('report-modal'),
  reportForm: document.getElementById('report-form'),
  modalMobName: document.getElementById('modal-mob-name'),
  modalStatus: document.getElementById('modal-status'),
  modalTimeInput: document.getElementById('report-datetime'),
  modalMemoInput: document.getElementById('report-memo')
};

export { RANK_COLORS, PROGRESS_CLASSES, FILTER_TO_DATA_RANK_MAP, DOM };
