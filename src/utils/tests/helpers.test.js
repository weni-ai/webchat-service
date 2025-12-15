import * as helpers from '../helpers';

describe('Helpers', () => {
  describe('generateUUID', () => {
    const cryptoGetSpy = jest.spyOn(global, 'crypto', 'get');

    afterEach(() => {
      cryptoGetSpy.mockReset();
    });

    describe('when the native function is available', () => {
      it('should call the native function', () => {
        const randomUUID = jest.fn(() => 'uuid-from-native-function');
        cryptoGetSpy.mockReturnValue({ randomUUID });

        const generatedUUID = helpers.generateUUID();

        expect(randomUUID).toHaveBeenCalled();
        expect(generatedUUID).toBe('uuid-from-native-function');
      });
    });

    describe('when the native function is not available', () => {
      it('should use the fallback', () => {
        cryptoGetSpy.mockReturnValue({});

        const generatedUUID = helpers.generateUUID();

        const UUIDRegex =
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        expect(generatedUUID).toMatch(UUIDRegex);
      });
    });
  });

  describe('generateSessionId', () => {
    const locationGetSpy = jest.spyOn(global, 'location', 'get');

    const fixedRandomValue = 12.3;
    const fixedDateNowValue = 1234;
    const fixedRandomIdValue = 15178;

    const mathGetSpy = jest.spyOn(global.Math, 'random');
    const dateNowSpy = jest.spyOn(global.Date, 'now');

    beforeEach(() => {
      mathGetSpy.mockReturnValue(fixedRandomValue);
      dateNowSpy.mockReturnValue(fixedDateNowValue);
    });

    afterEach(() => {
      locationGetSpy.mockReset();

      mathGetSpy.mockReset();
      dateNowSpy.mockReset();
    });

    describe('when no client ID is provided', () => {
      it('should use the hostname as the client ID', () => {
        locationGetSpy.mockReturnValue({ hostname: 'test.service' });

        const sessionId = helpers.generateSessionId();
        expect(sessionId).toBe(`${fixedRandomIdValue}@test.service`);
      });
    });

    describe('when a client ID is provided', () => {
      it('should use the provided client ID', () => {
        const sessionId = helpers.generateSessionId('another.test.service');
        expect(sessionId).toBe(`${fixedRandomIdValue}@another.test.service`);
      });
    });
  });

  describe('generateMessageId', () => {
    const dateNowSpy = jest.spyOn(global.Date, 'now');
    const mathGetSpy = jest.spyOn(global.Math, 'random');

    const fixedDateNowValue = 1234;
    const fixedRandomValue = 0.3456789;
    const fixedMessageIdValue = 'msg_1234_cfzzt7g4h';

    beforeEach(() => {
      dateNowSpy.mockReturnValue(fixedDateNowValue);
      mathGetSpy.mockReturnValue(fixedRandomValue);
    });

    afterEach(() => {
      dateNowSpy.mockReset();
      mathGetSpy.mockReset();
    });

    it('should generate a message ID', () => {
      const messageId = helpers.generateMessageId();
      expect(messageId).toBe(fixedMessageIdValue);
    });
  });

  describe('formatTimestamp', () => {
    it('should format the timestamp to a readable string', () => {
      const timestamp = 1760697000000;
      const formattedTimestamp = helpers.formatTimestamp(
        timestamp,
        'en-US',
        'UTC',
      );

      expect(formattedTimestamp).toBe('Oct 17, 2025, 10:30 AM');
    });
  });

  describe('formatFileSize', () => {
    it.each([
      [0, '0 Bytes'],
      [1023, '1023 Bytes'],
      [1024, '1 KB'],
      [1024 * 1024, '1 MB'],
      [1024 * 1024 * 1024, '1 GB'],
    ])(
      'should format the file size %s to a %s string',
      (fileSize, expected) => {
        const formattedFileSize = helpers.formatFileSize(fileSize);
        expect(formattedFileSize).toBe(expected);
      },
    );
  });

  describe('debounce', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should debounce a function and call it after the delay', () => {
      const func = jest.fn();
      const debouncedFunc = helpers.debounce(func, 1000);
      debouncedFunc();
      expect(func).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1000);
      expect(func).toHaveBeenCalled();
    });

    it('should debounce a function multiple times and call it once after the delay', () => {
      const func = jest.fn();
      const debouncedFunc = helpers.debounce(func, 1000);
      debouncedFunc();
      debouncedFunc();
      jest.advanceTimersByTime(1000);
      expect(func).toHaveBeenCalledTimes(1);
    });
  });

  describe('throttle', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should throttle a function and call it once after the delay and not call it again until the delay is over', () => {
      const func = jest.fn();
      const throttledFunc = helpers.throttle(func, 1000);

      throttledFunc();
      throttledFunc();
      expect(func).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(1000);
      throttledFunc();
      expect(func).toHaveBeenCalledTimes(2);

      jest.advanceTimersByTime(1000);
      throttledFunc();
      throttledFunc();
      expect(func).toHaveBeenCalledTimes(3);
    });
  });

  describe('deepClone', () => {
    it('should deep clone an object', () => {
      const obj = {
        a: 1,
        b: {
          c: 2,
          d: new Date(),
          e: [1, 2, 3],
          f: null,
          g: undefined,
        },
      };

      const clonedObj = helpers.deepClone(obj);
      expect(clonedObj).toEqual(obj);
      expect(clonedObj).not.toBe(obj);
    });
  });

  describe('isEmpty', () => {
    it.each([null, undefined, '', ' ', [], {}])(
      "should return true if the value is '%s'",
      (value) => {
        const isEmpty = helpers.isEmpty(value);
        expect(isEmpty).toBeTruthy();
      },
    );

    it.each([1, 'hello', [1, 2, 3], { a: 1, b: 2 }])(
      "should return false if the value is '%s'",
      (value) => {
        const isEmpty = helpers.isEmpty(value);
        expect(isEmpty).toBeFalsy();
      },
    );
  });

  describe('safeJsonParse', () => {
    it('should parse a valid JSON string', () => {
      const json = '{"a": 1, "b": 2}';
      const parsedJson = helpers.safeJsonParse(json);
      expect(parsedJson).toEqual({ a: 1, b: 2 });
    });

    it('should return the default value if the JSON string is invalid', () => {
      const json = 'invalid';
      const defaultValue = { a: 1, b: 2 };
      const parsedJson = helpers.safeJsonParse(json, defaultValue);
      expect(parsedJson).toEqual(defaultValue);
    });
  });

  describe('retry', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    describe('when the function succeeds', () => {
      it('should return the result', async () => {
        const func = jest.fn().mockResolvedValue(42);
        const result = await helpers.retry(func, 3, 1000);
        expect(func).toHaveBeenCalledTimes(1);
        expect(result).toBe(42);
      });
    });

    describe('when the function fails 1 time', () => {
      it('should retry the function and return the result', async () => {
        const func = jest
          .fn()
          .mockRejectedValueOnce(new Error('1st fail'))
          .mockResolvedValueOnce(42);

        const promise = helpers.retry(func, 2, 1000);
        expect(func).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(1000);
        expect(func).toHaveBeenCalledTimes(2);

        await expect(promise).resolves.toBe(42);
      });
    });

    describe('when the function fails less than the retries', () => {
      it('should retry the function and return the result', async () => {
        const func = jest
          .fn()
          .mockRejectedValueOnce(new Error('1st fail'))
          .mockRejectedValueOnce(new Error('2nd fail'))
          .mockResolvedValueOnce(42);

        const promise = helpers.retry(func, 2, 1000);
        expect(func).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(1000);
        expect(func).toHaveBeenCalledTimes(2);

        await jest.advanceTimersByTimeAsync(1000);
        expect(func).toHaveBeenCalledTimes(3);

        await expect(promise).resolves.toBe(42);
      });
    });

    describe('when the function fails more than the retries', () => {
      it('should retry the function and throw an error', async () => {
        expect.assertions(5);

        const func = jest
          .fn()
          .mockRejectedValueOnce(new Error('1st fail'))
          .mockRejectedValueOnce(new Error('2nd fail'))
          .mockRejectedValueOnce(new Error('3rd fail'));

        const promise = helpers.retry(func, 2, 1000).catch((error) => {
          expect(error.message).toBe('3rd fail');
        });

        expect(func).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(1000);
        expect(func).toHaveBeenCalledTimes(2);

        await jest.advanceTimersByTimeAsync(1000);
        expect(func).toHaveBeenCalledTimes(3);

        const result = await promise;
        expect(result).toBeUndefined();
      });
    });

    describe('when there is not retries and delay is not provided', () => {
      it('should use the default retries and delay', async () => {
        expect.assertions(6);

        const func = jest
          .fn()
          .mockRejectedValueOnce(new Error('1st fail'))
          .mockRejectedValueOnce(new Error('2nd fail'))
          .mockRejectedValueOnce(new Error('3rd fail'))
          .mockRejectedValueOnce(new Error('4th fail'));

        const promise = helpers.retry(func).catch((error) => {
          expect(error.message).toBe('4th fail');
        });

        expect(func).toHaveBeenCalledTimes(1);

        await jest.advanceTimersByTimeAsync(1000);
        expect(func).toHaveBeenCalledTimes(2);

        await jest.advanceTimersByTimeAsync(1000);
        expect(func).toHaveBeenCalledTimes(3);

        await jest.advanceTimersByTimeAsync(1000);
        expect(func).toHaveBeenCalledTimes(4);

        const result = await promise;
        expect(result).toBeUndefined();
      });
    });
  });

  describe('withTimeout', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    describe('when the promise is resolved in time', () => {
      it('should return the result of the promise', async () => {
        const promise = helpers.withTimeout(
          new Promise((resolve) => setTimeout(() => resolve(42), 900)),
          1000,
        );

        await jest.advanceTimersByTimeAsync(1000);

        await expect(promise).resolves.toBe(42);
      });
    });

    describe('when the promise is not resolved in time', () => {
      it('should reject the promise', async () => {
        expect.assertions(2);

        const promise = helpers
          .withTimeout(
            new Promise((resolve) => setTimeout(() => resolve(42), 1100)),
            1000,
          )
          .catch((error) => {
            expect(error.message).toBe('Operation timed out');
          });

        await jest.advanceTimersByTimeAsync(1000);

        const result = await promise;

        expect(result).toBeUndefined();
      });
    });
  });
});
