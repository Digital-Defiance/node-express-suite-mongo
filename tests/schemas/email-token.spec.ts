import { EmailTokenType } from '@digitaldefiance/suite-core-lib';
import { BaseModelName } from '../../src/enumerations';
import {
  createEmailTokenSchema,
  EmailTokenSchema,
} from '../../src/schemas/email-token';

describe('EmailTokenSchema', () => {
  describe('createEmailTokenSchema', () => {
    it('should create schema with default options', () => {
      const schema = createEmailTokenSchema();
      expect(schema).toBeDefined();
      expect(schema.path('userId')).toBeDefined();
      expect(schema.path('type')).toBeDefined();
      expect(schema.path('token')).toBeDefined();
      expect(schema.path('email')).toBeDefined();
    });

    it('should create schema with custom token types', () => {
      const customTypes = [
        EmailTokenType.AccountVerification,
        EmailTokenType.PasswordReset,
      ];
      const schema = createEmailTokenSchema({ tokenTypeEnum: customTypes });
      expect(schema).toBeDefined();
    });

    it('should create schema with custom user model name', () => {
      const schema = createEmailTokenSchema({
        userModelName: 'CustomUser' as BaseModelName,
      });
      expect(schema).toBeDefined();
    });

    it('should create schema with custom expires in', () => {
      const schema = createEmailTokenSchema({ expiresIn: '2d' });
      expect(schema).toBeDefined();
    });

    it('should create schema with custom validation message', () => {
      const customMessage = (props: { value: string }) =>
        `Invalid: ${props.value}`;
      const schema = createEmailTokenSchema({
        validationMessage: customMessage,
      });
      expect(schema).toBeDefined();
    });
  });

  describe('EmailTokenSchema', () => {
    it('should be defined', () => {
      expect(EmailTokenSchema).toBeDefined();
    });
  });
});
