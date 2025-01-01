import { time } from '@nomicfoundation/hardhat-network-helpers';

export function range(length: number, offset: number = 0): number[] {
  return Array.from({ length }, (_, i) => offset + i);
}

export async function advanceTime(seconds: number): Promise<void> {
  await time.increase(seconds);
}

export async function advanceTimeTo(seconds: number): Promise<void> {
  await time.increaseTo(seconds);
}

// 7 days in seconds. This is the distance between draws.
const SEVEN_DAYS = 60 * 60 * 24 * 7;

export async function advanceTimeToNextDrawing(): Promise<void> {
  const offset = 244800; // first Saturday evening since Unix Epoch, in seconds
  const now = await time.latest();
  const nextDrawTime = offset + Math.ceil((now - offset) / SEVEN_DAYS) * SEVEN_DAYS;
  await time.increaseTo(nextDrawTime);
}
