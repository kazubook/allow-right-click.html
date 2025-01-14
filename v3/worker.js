/* global URLPattern */

const notify = message => chrome.notifications.create({
  title: chrome.runtime.getManifest().name,
  message,
  type: 'basic',
  iconUrl: 'data/icons/48.png'
});

const onClicked = (tabId, obj) => chrome.scripting.executeScript({
  target: {
    tabId,
    ...obj
  },
  files: ['data/inject/core.js']
}, () => {
  const lastError = chrome.runtime.lastError;
  if (lastError) {
    console.warn(lastError);
    notify(lastError.message);
  }
});
chrome.action.onClicked.addListener(tab => onClicked(tab.id, {
  allFrames: true
}));


chrome.runtime.onMessage.addListener((request, sender, response) => {
  if (request.method === 'status') {
    chrome.scripting.executeScript({
      target: {
        tabId: sender.tab.id
      },
      func: () => window.pointers.status
    }, r => response(r[0].result));

    return true;
  }
  else if (request.method === 'inject') {
    if (sender.frameId === 0) {
      chrome.action.setIcon({
        tabId: sender.tab.id,
        path: {
          '16': 'data/icons/active/16.png',
          '32': 'data/icons/active/32.png',
          '48': 'data/icons/active/48.png'
        }
      });
    }
    for (const file of request.files) {
      chrome.scripting.executeScript({
        target: {
          tabId: sender.tab.id,
          frameIds: [sender.frameId]
        },
        files: ['data/inject/' + file]
      });
    }
  }
  else if (request.method === 'release') {
    if (sender.frameId === 0) {
      chrome.action.setIcon({
        tabId: sender.tab.id,
        path: {
          '16': 'data/icons/16.png',
          '32': 'data/icons/32.png',
          '48': 'data/icons/48.png'
        }
      });
    }
  }
  else if (request.method === 'inject-unprotected') {
    chrome.scripting.executeScript({
      target: {
        tabId: sender.tab.id,
        frameIds: [sender.frameId]
      },
      func: code => {
        const script = document.createElement('script');
        script.classList.add('arclck');
        script.textContent = 'document.currentScript.dataset.injected = true;' + code;
        document.documentElement.appendChild(script);
        if (script.dataset.injected !== 'true') {
          const s = document.createElement('script');
          s.classList.add('arclck');
          s.src = 'data:text/javascript;charset=utf-8;base64,' + btoa(code);
          document.documentElement.appendChild(s);
          script.remove();
        }
      },
      args: [request.code],
      world: 'MAIN'
    });
  }
  else if (request.method === 'simulate-click') {
    onClicked(sender.tab.id, {
      frameIds: [sender.frameId]
    });
  }
});

// automation
{
  const observe = () => chrome.storage.local.get({
    monitor: false,
    hostnames: []
  }, async prefs => {
    await chrome.scripting.unregisterContentScripts({
      ids: ['monitor']
    }).catch(() => {});

    if (prefs.monitor && prefs.hostnames.length) {
      const matches = [];
      for (const hostname of prefs.hostnames) {
        try {
          new URLPattern('*://' + hostname + '/*');
          matches.push('*://' + hostname + '/*');
        }
        catch (e) {
          console.warn(hostname, 'rule is ignored / 1');
        }
        try {
          new URLPattern('*://*.' + hostname + '/*');
          matches.push('*://*.' + hostname + '/*');
        }
        catch (e) {
          console.warn(hostname, 'rule is ignored / 2');
        }
      }
      if (matches.length) {
        chrome.scripting.registerContentScripts([{
          allFrames: true,
          matchOriginAsFallback: true,
          runAt: 'document_start',
          id: 'monitor',
          js: ['/data/monitor.js'],
          matches
        }]);
      }
    }
  });
  observe();
  chrome.storage.onChanged.addListener(prefs => {
    if (
      (prefs.monitor && prefs.monitor.newValue !== prefs.monitor.oldValue) ||
      (prefs.hostnames && prefs.hostnames.newValue !== prefs.hostnames.oldValue)
    ) {
      observe();
    }
    if (prefs.monitor) {
      permission();
    }
  });
}

// permission
const permission = () => chrome.permissions.contains({
  origins: ['*://*/*']
}, granted => {
  chrome.contextMenus.update('inject-sub', {
    enabled: granted === false,
    title: 'Unblock Sub-Frame Elements' + (granted ? ' (already has access)' : '')
  });
});

// context menu
{
  const callback = () => {
    chrome.contextMenus.create({
      id: 'add-to-whitelist',
      title: 'Automatically Activate this Extension on this Hostname',
      contexts: ['action']
    });
    chrome.contextMenus.create({
      id: 'inject-sub',
      title: 'Unblock Sub-Frame Elements',
      contexts: ['action']
    }, permission);
  };
  chrome.runtime.onInstalled.addListener(callback);
  chrome.runtime.onStartup.addListener(callback);
}
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'inject-sub') {
    chrome.permissions.request({
      origins: ['*://*/*']
    }, permission);
  }
  else {
    const url = tab.url || info.pageUrl;
    if (url.startsWith('http')) {
      const {hostname} = new URL(url);
      chrome.storage.local.get({
        hostnames: []
      }, prefs => {
        chrome.storage.local.set({
          hostnames: [...prefs.hostnames, hostname].filter((s, i, l) => s && l.indexOf(s) === i)
        });
      });

      chrome.permissions.contains({
        origins: ['*://*/*']
      }, granted => {
        if (granted) {
          chrome.storage.local.set({
            monitor: true
          });
          notify(`"${hostname}" is added to the list`);
        }
        else {
          notify('For this feature to work, you need to enable host permission from the options page');
          setTimeout(() => chrome.runtime.openOptionsPage(), 3000);
        }
      });
    }
    else {
      notify('This is not a valid URL: ' + url);
    }
  }
});

/* FAQs & Feedback */
{
  const {management, runtime: {onInstalled, setUninstallURL, getManifest}, storage, tabs} = chrome;
  if (navigator.webdriver !== true) {
    const page = getManifest().homepage_url;
    const {name, version} = getManifest();
    onInstalled.addListener(({reason, previousVersion}) => {
      management.getSelf(({installType}) => installType === 'normal' && storage.local.get({
        'faqs': true,
        'last-update': 0
      }, prefs => {
        if (reason === 'install' || (prefs.faqs && reason === 'update')) {
          const doUpdate = (Date.now() - prefs['last-update']) / 1000 / 60 / 60 / 24 > 45;
          if (doUpdate && previousVersion !== version) {
            tabs.query({active: true, currentWindow: true}, tbs => tabs.create({
              url: page + '?version=' + version + (previousVersion ? '&p=' + previousVersion : '') + '&type=' + reason,
              active: reason === 'install',
              ...(tbs && tbs.length && {index: tbs[0].index + 1})
            }));
            storage.local.set({'last-update': Date.now()});
          }
        }
      }));
    });
    setUninstallURL(page + '?rd=feedback&name=' + encodeURIComponent(name) + '&version=' + version);
  }
}
