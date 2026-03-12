/**
 * @fileoverview Mnemonic phrase management service.
 * Securely stores mnemonic HMACs for uniqueness checking without exposing phrases.
 * @module services/mnemonic
 */

import { SecureBuffer, SecureString } from '@digitaldefiance/ecies-lib';
import { ClientSession, Model } from '@digitaldefiance/mongoose-types';
import {
  SuiteCoreStringKey,
  TranslatableSuiteError,
} from '@digitaldefiance/suite-core-lib';
import { createHmac } from 'crypto';
import { MnemonicDocument } from '../documents/mnemonic';
import type { IConstants } from '@digitaldefiance/node-express-suite';
import type { PlatformID } from '@digitaldefiance/node-ecies-lib';

/**
 * Service for secure mnemonic phrase storage and validation.
 * Uses HMAC for uniqueness checking without storing actual mnemonics.
 */
export class MnemonicService<TID extends PlatformID = Buffer> {
  private readonly hmacSecret: SecureBuffer;
  private readonly MnemonicModel: Model<MnemonicDocument<TID>>;
  private readonly constants: IConstants;

  constructor(
    mnemonicModel: Model<MnemonicDocument<TID>>,
    hmacSecret: SecureBuffer,
    constants: IConstants,
  ) {
    this.MnemonicModel = mnemonicModel;
    this.hmacSecret = hmacSecret;
    this.constants = constants;
  }

  public dispose(): void {
    this.hmacSecret.dispose();
  }

  public getMnemonicHmac(mnemonic: SecureString): string {
    return createHmac('sha256', this.hmacSecret.value)
      .update(mnemonic.valueAsUint8Array)
      .digest('hex');
  }

  public async mnemonicExists(
    mnemonic: SecureString,
    session?: ClientSession,
  ): Promise<boolean> {
    const hmac = this.getMnemonicHmac(mnemonic);
    const count = await this.MnemonicModel.countDocuments({ hmac }).session(
      session ?? null,
    );
    return count > 0;
  }

  public async addMnemonicWithPassword(
    mnemonic: SecureString,
    _password: SecureString,
    session?: ClientSession,
  ): Promise<{
    document: MnemonicDocument<TID> | null;
  }> {
    if (!mnemonic.value || !this.constants.MnemonicRegex.test(mnemonic.value)) {
      throw new TranslatableSuiteError(
        SuiteCoreStringKey.Validation_MnemonicRegex,
      );
    }

    if (await this.mnemonicExists(mnemonic, session)) {
      return { document: null };
    }

    try {
      const hmac = this.getMnemonicHmac(mnemonic);
      const [newDoc] = await this.MnemonicModel.create(
        [
          {
            hmac: hmac,
          },
        ],
        { session },
      );
      return { document: newDoc };
    } finally {
      // nothing to dispose
    }
  }

  public async addMnemonic(
    mnemonic: SecureString,
    session?: ClientSession,
  ): Promise<MnemonicDocument<TID> | null> {
    if (!mnemonic.value || !this.constants.MnemonicRegex.test(mnemonic.value)) {
      throw new TranslatableSuiteError(
        SuiteCoreStringKey.Validation_MnemonicRegex,
      );
    }

    if (await this.mnemonicExists(mnemonic, session)) {
      return null;
    }
    const hmac = this.getMnemonicHmac(mnemonic);
    const [newDoc] = await this.MnemonicModel.create(
      [
        {
          hmac: hmac,
        },
      ],
      { session },
    );
    return newDoc;
  }

  public async getMnemonicDocument(
    mnemonicId: TID,
    session?: ClientSession,
  ): Promise<MnemonicDocument<TID> | null> {
    return await this.MnemonicModel.findById(mnemonicId).session(
      session ?? null,
    );
  }

  public async deleteMnemonicDocument(
    mnemonicId: TID,
    session?: ClientSession,
  ): Promise<void> {
    await this.MnemonicModel.findByIdAndDelete(mnemonicId).session(
      session ?? null,
    );
  }
}
