export class BadRequestError extends Error {
  constructor() {
    super("输入信息无效");
    this.name = "BadRequestError";
  }
}

export class ForbiddenRequestError extends Error {
  constructor() {
    super("请求来源无效");
    this.name = "ForbiddenRequestError";
  }
}

export class UnsupportedMediaTypeError extends Error {
  constructor() {
    super("请求格式不受支持");
    this.name = "UnsupportedMediaTypeError";
  }
}

export class PayloadTooLargeError extends Error {
  constructor() {
    super("请求内容过大");
    this.name = "PayloadTooLargeError";
  }
}

export class RateLimitedError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("尝试次数过多，请稍后再试");
    this.name = "RateLimitedError";
  }
}

export class InvalidClassCodeError extends Error {
  constructor() {
    super("班级邀请码无效");
    this.name = "InvalidClassCodeError";
  }
}

export class InvalidIdentityCodeError extends Error {
  constructor() {
    super("匿名编号无效");
    this.name = "InvalidIdentityCodeError";
  }
}

export class InvalidTeacherCodeError extends Error {
  constructor() {
    super("教师访问码无效");
    this.name = "InvalidTeacherCodeError";
  }
}
