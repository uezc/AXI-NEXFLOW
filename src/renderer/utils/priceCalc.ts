/**
 * 图片/视频单次生成价格计算（元/次）
 * 用于运行按钮旁与批量运行按钮旁展示「¥X.XX/次」
 */

/** 图片节点数据（用于从 node.data 计算价格） */
export interface ImagePriceParams {
  model: string;
  resolution?: string;
}

/** 视频节点数据（用于从 node.data 计算价格） */
export interface VideoPriceParams {
  model: string;
  duration?: '5' | '10' | '15' | '25';
  sound?: 'true' | 'false';
  durationHailuo02?: '6' | '10';
  durationKlingO1?: '5' | '10';
  modeKlingO1?: 'std' | 'pro';
  durationRhartVideoG?: '6s' | '10s';
  resolutionRhartV31?: '720p' | '1080p' | '4k';
  resolutionWan26?: '720p' | '1080p';
  durationWan26Flash?: string;
  enableAudio?: boolean;
}

/**
 * 图片生成价格（元/次）
 * 全能图片PRO: 1k-0.2, 2k-0.2, 4k-0.3；全能图片G-1.5: 0.03；文悠船文生图-v7: 0.54
 */
export function getImagePrice(params: ImagePriceParams): number | null {
  const { model } = params;
  if (model === 'nano-banana-2') return 0.2;
  if (model === 'nano-banana-2-2k') return 0.2;
  if (model === 'nano-banana-2-4k') return 0.3;
  if (model === 'rhart-image-g-1.5') return 0.03;
  if (model === 'youchuan-text-to-image-v7') return 0.54;
  if (model === 'seedream-v4.5') return 0.2; // 图生图/文生图 仅需¥0.2/张
  return null;
}

/**
 * 视频生成价格（元/次）
 * 按模型与时长/分辨率/有声无声等参数
 */
export function getVideoPrice(params: VideoPriceParams): number | null {
  const {
    model,
    duration = '10',
    sound = 'false',
    durationHailuo02 = '6',
    durationKlingO1 = '5',
    modeKlingO1 = 'std',
    durationRhartVideoG = '6s',
    resolutionRhartV31 = '1080p',
    resolutionWan26 = '1080p',
    durationWan26Flash = '5',
    enableAudio = true,
  } = params;

  // 海螺-02/2.3 文生、图生：6秒 1.5/次，10秒 3/次
  if (
    model === 'hailuo-02-t2v-standard' ||
    model === 'hailuo-02-i2v-standard' ||
    model === 'hailuo-2.3-t2v-standard' ||
    model === 'hailuo-2.3-i2v-standard'
  ) {
    return durationHailuo02 === '10' ? 3 : 1.5;
  }

  // 可灵 2.6-pro 文生/图生：5秒有声3.5 5秒无声1.75 10秒有声7 10秒无声3.5
  if (model === 'kling-v2.6-pro') {
    const sec = duration === '5' ? 5 : 10;
    const withSound = sound === 'true';
    if (sec === 5 && withSound) return 3.5;
    if (sec === 5 && !withSound) return 1.75;
    if (sec === 10 && withSound) return 7;
    if (sec === 10 && !withSound) return 3.5;
    return null;
  }

  // 可灵 o1 文生 / 可灵图生视频o1：std 5秒2.1/次、10秒4.2/次，pro 5秒2.8/次、10秒5.6/次
  if (model === 'kling-video-o1' || model === 'kling-video-o1-i2v') {
    const std = modeKlingO1 === 'std';
    if (durationKlingO1 === '5') return std ? 2.1 : 2.8;
    if (durationKlingO1 === '10') return std ? 4.2 : 5.6;
    return null;
  }

  // 全能视频G 图生/文生：6s 0.2/次，10s 0.35/次
  if (model === 'rhart-video-g') {
    return durationRhartVideoG === '10s' ? 0.35 : 0.2;
  }

  // 全能V3.1-fast 图生/文生/首尾帧：720p 0.2 1080p 0.25 4k 0.5
  if (model === 'rhart-v3.1-fast' || model === 'rhart-v3.1-fast-se') {
    if (resolutionRhartV31 === '720p') return 0.2;
    if (resolutionRhartV31 === '1080p') return 0.25;
    if (resolutionRhartV31 === '4k') return 0.5;
    return 0.25;
  }

  // 全能V3.1-pro 首尾帧/文生：720p 0.8 1080p 1 4k 1.4
  if (model === 'rhart-v3.1-pro' || model === 'rhart-v3.1-pro-se') {
    if (resolutionRhartV31 === '720p') return 0.8;
    if (resolutionRhartV31 === '1080p') return 1;
    if (resolutionRhartV31 === '4k') return 1.4;
    return 1;
  }

  // 万相2.6 图生视频：720p 5s 2.25, 10s 4.5, 15s 6.75；1080p 5s 3.75, 10s 7.5, 15s 11.25
  if (model === 'wan-2.6') {
    const d = Number(duration) || 10;
    if (resolutionWan26 === '720p') {
      if (d <= 5) return 2.25;
      if (d <= 10) return 4.5;
      return 6.75;
    }
    if (resolutionWan26 === '1080p') {
      if (d <= 5) return 3.75;
      if (d <= 10) return 7.5;
      return 11.25;
    }
    return 4.5;
  }

  // 万相2.6 Flash 图生视频：按秒计费 720p 有音0.23/秒 无音0.11/秒；1080p 有音0.38/秒 无音0.19/秒
  if (model === 'wan-2.6-flash') {
    const sec = Number(durationWan26Flash) || 5;
    const hasAudio = enableAudio !== false;
    if (resolutionWan26 === '720p') return (hasAudio ? 0.23 : 0.11) * sec;
    if (resolutionWan26 === '1080p') return (hasAudio ? 0.38 : 0.19) * sec;
    return (hasAudio ? 0.23 : 0.11) * sec;
  }

  // sora-2 文生视频 / 图生视频：0.5/次
  if (model === 'sora-2') return 0.5;

  // sora-2-pro 文生视频：2/次
  if (model === 'sora-2-pro') return 2;

  // 全能视频S-图生视频-pro（展示名 Sora2 Pro）：15s/25s 图生，2/次
  if (model === 'rhart-video-s-i2v-pro') return 2;

  // 可灵01 (参考) kling-video-o1-ref：std 5秒 3.15/次、10秒 6.3/次，pro 5秒 4.2/次、10秒 8.4/次
  if (model === 'kling-video-o1-ref') {
    const std = modeKlingO1 === 'std';
    if (durationKlingO1 === '5') return std ? 3.15 : 4.2;
    if (durationKlingO1 === '10') return std ? 6.3 : 8.4;
    return std ? 3.15 : 4.2;
  }

  // 可灵首尾帧等：未提供定价
  return null;
}

/**
 * 图像反推价格（元/次）
 * Joy Caption Two 反推 0.036/次，GPT-4o 反推 约 0.002422/次
 */
export function getImageReversePrice(model: 'gpt-4o' | 'joy-caption-two'): number | null {
  if (model === 'joy-caption-two') return 0.036;
  if (model === 'gpt-4o') return 0.002422;
  return null;
}

/**
 * 音频生成价格（元/次）
 * 全能写歌 0.5/次
 */
export function getAudioPrice(model: string): number | null {
  if (model === 'rhart-song') return 0.5;
  return null;
}

/**
 * 根据节点类型与 node.data 计算单节点价格（用于批量总价）
 */
export function getNodePrice(
  nodeType: string,
  data: Record<string, unknown> | undefined
): number | null {
  if (!data) return null;
  if (nodeType === 'image') {
    return getImagePrice({
      model: (data.model as string) || 'nano-banana-2',
      resolution: data.resolution as string | undefined,
    });
  }
  if (nodeType === 'llm') {
    const reverseModel = data.reverseCaptionModel as 'gpt-4o' | 'joy-caption-two' | undefined;
    if (reverseModel) return getImageReversePrice(reverseModel);
    return null;
  }
  if (nodeType === 'video') {
    return getVideoPrice({
      model: (data.model as string) || 'sora-2',
      duration: data.duration as VideoPriceParams['duration'],
      sound: data.sound as VideoPriceParams['sound'],
      durationHailuo02: data.durationHailuo02 as VideoPriceParams['durationHailuo02'],
      durationKlingO1: data.durationKlingO1 as VideoPriceParams['durationKlingO1'],
      modeKlingO1: data.modeKlingO1 as VideoPriceParams['modeKlingO1'],
      durationRhartVideoG: data.durationRhartVideoG as VideoPriceParams['durationRhartVideoG'],
      resolutionRhartV31: data.resolutionRhartV31 as VideoPriceParams['resolutionRhartV31'],
      resolutionWan26: data.resolutionWan26 as VideoPriceParams['resolutionWan26'],
      durationWan26Flash: data.durationWan26Flash as string | undefined,
      enableAudio: data.enableAudio as boolean | undefined,
    });
  }
  if (nodeType === 'audio') {
    return getAudioPrice((data.model as string) || '');
  }
  return null;
}
