import { LocalhostConstants } from '@digitaldefiance/node-express-suite';
import {
  createMnemonicSchema,
  MnemonicSchema,
} from '../../src/schemas/mnemonic';

describe('MnemonicSchema', () => {
  describe('createMnemonicSchema', () => {
    it('should create schema with default options', () => {
      const schema = createMnemonicSchema();
      expect(schema).toBeDefined();
      expect(schema.path('hmac')).toBeDefined();
    });

    it('should create schema with custom validation message', () => {
      const customMessage = () => 'Custom validation error';
      const schema = createMnemonicSchema(customMessage);
      expect(schema).toBeDefined();
    });

    it('should create schema with custom constants', () => {
      const customConstants = {
        ...LocalhostConstants,
        HmacRegex: /^[a-f0-9]{64}$/,
      };
      const schema = createMnemonicSchema(undefined, customConstants);
      expect(schema).toBeDefined();
    });
  });

  describe('MnemonicSchema', () => {
    it('should be defined', () => {
      expect(MnemonicSchema).toBeDefined();
    });
  });
});
