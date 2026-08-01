import { describe, expect, it } from "vitest";

import {
  touchDesignerOperatorChinese,
  touchDesignerParameterChinese,
} from "@/lib/touchdesigner/localization";

describe("TouchDesigner Chinese localization", () => {
  it("explains known operators in teaching language", () => {
    expect(touchDesignerOperatorChinese("noise", "TOP")).toEqual({
      label: "噪声",
      description: "生成随机但连续的纹理或数值变化。",
    });
  });

  it("keeps unknown English operators with a Chinese family fallback", () => {
    expect(touchDesignerOperatorChinese("customGpuFx", "TOP")).toEqual({
      label: "图像节点",
      description: "用于当前网络中的图像数据处理；保留英文类型 customGpuFx，方便回到 TouchDesigner 中查找。",
    });
  });

  it("translates frequent parameters and handles case differences", () => {
    expect(touchDesignerParameterChinese("resolutionw")).toBe("分辨率宽度");
    expect(touchDesignerParameterChinese("Backcolorb")).toBe("背景蓝色");
    expect(touchDesignerParameterChinese("brightness")).toBe("亮度");
  });

  it("builds a readable Chinese label from compound parameter tokens", () => {
    expect(touchDesignerParameterChinese("customAmplitude")).toBe("自定义振幅");
    expect(touchDesignerParameterChinese("unmappedSetting")).toBe("节点参数");
  });
});
