const toggle = document.getElementById('toggle');
const sublabel = document.getElementById('sublabel');
const opSlider = document.getElementById('opacity-slider');
const opValue = document.getElementById('opacity-value');

// load initial state

chrome.storage.sync.get({'enabled': true, opacity: 100 }, ({ enabled, opacity }) => {
  toggle.checked = enabled;
  sublabel.textContent = enabled ? 'Enabled' : 'Disabled';
  opSlider.value = opacity;
  opValue.textContent = opacity + '%';
});

// enable toggle
toggle.addEventListener('change', () => {
  const isOn = toggle.checked;
  sublabel.textContent = isOn ? 'Enabled' : 'Disabled';
  chrome.storage.sync.set({ enabled: isOn });
  sendMessage({ type: 'SET_ENABLED', enabled: isOn });
});

// opacity slider
opSlider.addEventListener('input', () => {
  const val = Number(opSlider.value);
  opValue.textContent = val + '%';
  chrome.storage.sync.set({ opacity: val });
  sendMessage({ type: 'SET_OPACITY', opacity: val });
});

// send Message to current tab
function sendMessage(msg) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id) chrome.tabs.sendMessage(tabs[0].id, msg);
  });
}