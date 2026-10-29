import { readCSV } from './csv';
self.onmessage = async ({ data }: MessageEvent<File>) => {
  try {
    self.postMessage({ source: await readCSV(data) });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : 'CSV 读取失败',
    });
  }
};
