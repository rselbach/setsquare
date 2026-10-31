import { SAVE_TO_LOCAL_STORAGE_TIMEOUT } from "../../../app_constants";
import { createSaveScheduler } from "../../../web/persistence/saveScheduler";

const pause = () => vi.advanceTimersByTimeAsync(SAVE_TO_LOCAL_STORAGE_TIMEOUT);

const schedulerWith = (drain: () => Promise<void> = async () => {}) => {
  const calls = {
    drain: vi.fn(drain),
    failed: vi.fn(),
    keepRecovery: vi.fn(),
    recoveryWritten: vi.fn(async () => {}),
  };
  return { calls, scheduler: createSaveScheduler(calls) };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createSaveScheduler", () => {
  it("saves once after a pause in editing", async () => {
    const { calls, scheduler } = schedulerWith();
    scheduler.saveSoon();
    await vi.advanceTimersByTimeAsync(SAVE_TO_LOCAL_STORAGE_TIMEOUT / 2);
    scheduler.saveSoon();
    scheduler.keepRecoverySoon();
    expect(calls.drain).not.toHaveBeenCalled();
    await pause();
    expect(calls.drain).toHaveBeenCalledTimes(1);
    expect(calls.keepRecovery).toHaveBeenCalledTimes(1);
  });

  it("makes edits made during a save wait for the next pause", async () => {
    let saveAgain: boolean | undefined;
    const { calls, scheduler } = schedulerWith(async () => {
      saveAgain ??= scheduler.saveAgain();
    });
    scheduler.saveSoon();
    await pause();
    expect(saveAgain).toBe(false);
    // a save queued while the first was in flight
    scheduler.enqueue();
    await scheduler.idle();
    expect(calls.drain).toHaveBeenCalledTimes(1);
    await pause();
    expect(calls.drain).toHaveBeenCalledTimes(2);
  });

  it("keeps saving while a caller waits for everything to save", async () => {
    const answers: boolean[] = [];
    const { calls, scheduler } = schedulerWith(async () => {
      answers.push(scheduler.saveAgain());
    });
    await scheduler.flush(() => true);
    expect(calls.drain).toHaveBeenCalledTimes(1);
    expect(answers).toEqual([true]);
  });

  it("flushes a waiting save instead of queueing another", async () => {
    const { calls, scheduler } = schedulerWith();
    await scheduler.flush(() => false);
    expect(calls.drain).not.toHaveBeenCalled();
    scheduler.saveSoon();
    await scheduler.flush(() => true);
    expect(calls.drain).toHaveBeenCalledTimes(1);
    expect(calls.recoveryWritten).toHaveBeenCalled();
  });

  it("reports a failed save and still runs the next", async () => {
    const failure = new Error("Chang locked the study room");
    const { calls, scheduler } = schedulerWith(async () => {
      if (calls.drain.mock.calls.length === 1) {
        throw failure;
      }
    });
    scheduler.enqueue();
    scheduler.enqueue();
    await scheduler.idle();
    expect(calls.failed).toHaveBeenCalledWith(failure);
    expect(calls.drain).toHaveBeenCalledTimes(2);
  });

  it("drops waiting saves and recovery writes on cancel", async () => {
    const { calls, scheduler } = schedulerWith();
    scheduler.saveSoon();
    scheduler.keepRecoverySoon();
    scheduler.cancel();
    await pause();
    expect(calls.drain).not.toHaveBeenCalled();
    expect(calls.keepRecovery).not.toHaveBeenCalled();
  });
});
