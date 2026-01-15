
const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 680,
        height: 800,
        backgroundColor: '#121212',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        },
        title: "Natla V2"
    });

    mainWindow.loadURL('http://localhost:5173');
    mainWindow.setMenu(null); // Remove default menu bar

    // Restore DevTools shortcut (Ctrl+Shift+I)
    mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.control && input.shift && input.key.toLowerCase() === 'i') {
            mainWindow.webContents.toggleDevTools();
            event.preventDefault();
        }
        // F12 support
        if (input.key === 'F12') {
            mainWindow.webContents.toggleDevTools();
            event.preventDefault();
        }
    });
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});