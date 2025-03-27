import fs from 'fs/promises';
import axios from 'axios';
import cfonts from 'cfonts';
import chalk from 'chalk';
import ora from 'ora';
import readline from 'readline';
import { Wallet } from 'ethers';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

function delay(seconds) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

function centerText(text, color = 'greenBright') {
  const terminalWidth = process.stdout.columns || 80;
  const textLength = text.length;
  const padding = Math.max(0, Math.floor((terminalWidth - textLength) / 2));
  return ' '.repeat(padding) + chalk[color](text);
}

const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.1 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/105.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Firefox/102.0'
];

function getRandomUserAgent() {
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

function getHeaders() {
  return {
    'User-Agent': getRandomUserAgent(),
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'origin': 'https://monadscore.xyz',
    'referer': 'https://monadscore.xyz/'
  };
}

function getAxiosConfig(proxy) {
  const config = {
    headers: getHeaders(),
    timeout: 60000
  };
  if (proxy) {
    config.httpsAgent = newAgent(proxy);
  }
  return config;
}

function newAgent(proxy) {
  if (proxy.startsWith('http://')) {
    return new HttpsProxyAgent(proxy);
  } else if (proxy.startsWith('socks4://') || proxy.startsWith('socks5://')) {
    return new SocksProxyAgent(proxy);
  } else {
    console.log(chalk.red(`Unsupported proxy type: ${proxy}`));
    return null;
  }
}

async function requestWithRetry(method, url, payload = null, config = null, retries = 3, backoff = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      let response;
      if (method === 'get') {
        response = await axios.get(url, config);
      } else if (method === 'post') {
        response = await axios.post(url, payload, config);
      } else if (method === 'put') {
        response = await axios.put(url, payload, config);
      } else {
        throw new Error(`Unsupported method: ${method}`);
      }
      return response;
    } catch (error) {
      if (i < retries - 1) {
        await delay(backoff / 1000);
        backoff *= 1.5;
        continue;
      } else {
        throw error;
      }
    }
  }
}

async function readAccounts() {
  try {
    const data = await fs.readFile('accounts.json', 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error(chalk.red(`Error reading accounts.json: ${error.message}`));
    return [];
  }
}

async function readProxies() {
  try {
    const data = await fs.readFile('proxy.txt', 'utf-8');
    return data
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
  } catch (error) {
    console.error(chalk.red(`Error reading proxy.txt: ${error.message}`));
    return [];
  }
}

async function getPublicIP(proxy) {
  try {
    const response = await requestWithRetry('get', 'https://api.ipify.org?format=json', null, getAxiosConfig(proxy));
    if (response && response.data && response.data.ip) {
      return response.data.ip;
    } else {
      return 'IP tidak ditemukan';
    }
  } catch (error) {
    return 'Error mengambil IP';
  }
}

async function claimTask(walletAddress, taskId, proxy) {
  const url = 'https://mscore.onrender.com/user/claim-task';
  const payload = { wallet: walletAddress, taskId };
  try {
    const response = await requestWithRetry('post', url, payload, getAxiosConfig(proxy));
    return response.data && response.data.message
      ? response.data.message
      : 'Task claim berhasil, tetapi tidak ada pesan dari server.';
  } catch (error) {
    return `Task ${taskId} gagal: ${error.response?.data?.message || error.message}`;
  }
}

async function updateStartTime(walletAddress, proxy) {
  const url = 'https://mscore.onrender.com/user/update-start-time';
  const payload = { wallet: walletAddress, startTime: Date.now() };
  try {
    const response = await requestWithRetry('put', url, payload, getAxiosConfig(proxy));
    const message = response.data && response.data.message ? response.data.message : 'Start node berhasil';
    const totalPoints =
      response.data && response.data.user && response.data.user.totalPoints !== undefined
        ? response.data.user.totalPoints
        : 'Tidak diketahui';
    return { message, totalPoints };
  } catch (error) {
    const message = `Start node gagal: ${error.response?.data?.message || error.message}`;
    const totalPoints =
      error.response && error.response.data && error.response.data.user && error.response.data.user.totalPoints !== undefined
        ? error.response.data.user.totalPoints
        : 'N/A';
    return { message, totalPoints };
  }
}

async function processAccount(account, index, total, proxy) {
  const { walletAddress, privateKey } = account;
  console.log(`\n`);
  console.log(chalk.bold.cyanBright('='.repeat(80)));
  console.log(chalk.bold.whiteBright(`Akun: ${index + 1}/${total}`));
  console.log(chalk.bold.whiteBright(`Wallet: ${walletAddress}`));
  const usedIP = await getPublicIP(proxy);
  console.log(chalk.bold.whiteBright(`IP yang DIgunakan : ${usedIP}`));
  console.log(chalk.bold.cyanBright('='.repeat(80)));

  let wallet;
  try {
    wallet = new Wallet(privateKey);
  } catch (error) {
    console.error(chalk.red(`Error membuat wallet: ${error.message}`));
    return;
  }

  const tasks = ['task003', 'task002', 'task001'];
  for (let i = 0; i < tasks.length; i++) {
    const spinnerTask = ora({ text: `Claiming Task ${i + 1}/3 ...`, spinner: 'dots2', color: 'cyan' }).start();
    const msg = await claimTask(walletAddress, tasks[i], proxy);
    if (msg.toLowerCase().includes('successfully') || msg.toLowerCase().includes('berhasil')) {
      spinnerTask.succeed(chalk.greenBright(` Claiming Task ${i + 1}/3: ${msg}`));
    } else {
      spinnerTask.fail(chalk.red(` Claiming Task ${i + 1}/3: ${msg}`));
    }
  }

  const spinnerStart = ora({ text: 'Starting Node...', spinner: 'dots2', color: 'cyan' }).start();
  const { message, totalPoints } = await updateStartTime(walletAddress, proxy);
  if (message.toLowerCase().includes('successfully') || message.toLowerCase().includes('berhasil')) {
    spinnerStart.succeed(chalk.greenBright(` Start Node Berhasil : ${message}`));
  } else {
    spinnerStart.fail(chalk.red(` Start Node Failed : ${message}`));
  }

  const spinnerPoints = ora({ text: 'Get Total Points ...', spinner: 'dots2', color: 'cyan' }).start();
  spinnerPoints.succeed(chalk.greenBright(` Total Points : ${totalPoints}`));
}

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise(resolve => rl.question(query, ans => {
    rl.close();
    resolve(ans);
  }));
}

async function run() {
  cfonts.say('NT Exhaust', {
    font: 'block',
    align: 'center',
    colors: ['cyan', 'magenta'],
    background: 'transparent',
    letterSpacing: 1,
    lineHeight: 1,
    space: true,
    maxLength: '0'
  });
  console.log(centerText("=== Telegram Channel 🚀 : NT Exhaust (@NTExhaust) ===\n"));

  const useProxyAns = await askQuestion('Ingin menggunakan proxy? (y/n): ');
  let proxies = [];
  let useProxy = false;
  if (useProxyAns.trim().toLowerCase() === 'y') {
    useProxy = true;
    proxies = await readProxies();
    if (proxies.length === 0) {
      console.log(chalk.yellow('Tidak ada proxy di proxy.txt. Lanjut tanpa proxy.'));
      useProxy = false;
    }
  }

  const accounts = await readAccounts();
  if (accounts.length === 0) {
    console.log(chalk.red('Tidak ada akun di accounts.json.'));
    return;
  }

  for (let i = 0; i < accounts.length; i++) {
    const proxy = useProxy ? proxies[i % proxies.length] : null;
    try {
      await processAccount(accounts[i], i, accounts.length, proxy);
    } catch (error) {
      console.error(chalk.red(`Error pada akun ${i + 1}: ${error.message}`));
    }
  }

  console.log(chalk.magentaBright('Auto Start Node selesai. Menunggu 24 jam sebelum pengulangan...'));
  await delay(86400);
  run();
}

run();