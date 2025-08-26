import { LitNodeClient } from "@lit-protocol/lit-node-client";
import { LIT_NETWORK, LIT_ABILITY } from "@lit-protocol/constants";
import { 
  createSiweMessageWithRecaps, 
  generateAuthSig,
} from "@lit-protocol/auth-helpers";
import { LitContracts } from "@lit-protocol/contracts-sdk";
import { 
  Hash,
  Address,
  Hex
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ethers } from "ethers";

export interface LitPKPExecutorConfig {
  pkpTokenId: string;
  pkpPublicKey: string;
  pkpEthAddress: Address;
  walletPrivateKey: Hex;
  litNetwork: string;
}

export interface ExecuteOperation {
  to: Address;
  value: bigint;
  data: Hex;
  operation?: number; // 0 = call, 1 = delegatecall
}

export class LitPKPExecutor {
  private litNodeClient: LitNodeClient;
  private pkpTokenId: string;
  private pkpPublicKey: string;
  private pkpEthAddress: Address;
  private walletAccount: ReturnType<typeof privateKeyToAccount>;
  private ethersSigner: ethers.Wallet;
  private litContracts: LitContracts | null = null;
  private isConnected = false;

  constructor(config: LitPKPExecutorConfig) {
    this.litNodeClient = new LitNodeClient({
      litNetwork: config.litNetwork as any,
      debug: false,
    });
    
    this.pkpTokenId = config.pkpTokenId;
    this.pkpPublicKey = config.pkpPublicKey;
    this.pkpEthAddress = config.pkpEthAddress;
    this.walletAccount = privateKeyToAccount(config.walletPrivateKey);
    
    // Create ethers signer for Lit contracts
    this.ethersSigner = new ethers.Wallet(config.walletPrivateKey);
  }

  async connect(): Promise<void> {
    if (this.isConnected) return;

    await this.litNodeClient.connect();
    
    // Skip LitContracts for now since we don't need them for basic signing
    // this.litContracts = new LitContracts({
    //   signer: this.ethersSigner,
    //   network: "datil-dev" as any,
    //   debug: false,
    // });
    // await this.litContracts.connect();
    
    this.isConnected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.isConnected) return;
    
    this.litNodeClient.disconnect();
    this.isConnected = false;
  }

  /**
   * Creates a Lit Action that validates and signs operations
   */
  private getLitActionCode(): string {
    return `
      const go = async () => {
        // Get the parameters passed to the Lit Action
        const { toSign, publicKey, sigName, chainId, targetAddress, value, data, operation } = Lit.Actions;
        
        // Basic validation - ensure we have required parameters
        if (!toSign || !publicKey || !sigName) {
          Lit.Actions.setResponse({ response: "Missing required parameters" });
          return;
        }

        // Validate the chainId if provided
        if (chainId && typeof chainId !== 'string') {
          Lit.Actions.setResponse({ response: "Invalid chainId" });
          return;
        }

        // Validate operation type (0 = call, 1 = delegatecall)
        if (operation && ![0, 1].includes(parseInt(operation))) {
          Lit.Actions.setResponse({ response: "Invalid operation type" });
          return;
        }

        // Log the operation for debugging (this won't be included in production)
        console.log('Signing operation:', {
          targetAddress,
          value: value?.toString(),
          dataLength: data?.length,
          operation,
          chainId
        });

        // Sign the operation
        const sigShare = await Lit.Actions.signEcdsa({ toSign, publicKey, sigName });
        
        Lit.Actions.setResponse({ response: "Operation signed successfully" });
      };

      go();
    `;
  }

  /**
   * Signs an operation using the PKP
   */
  async signOperation(
    operation: ExecuteOperation,
    chainId: number,
    userOpHash: Hash
  ): Promise<{ signature: Hex; success: boolean }> {
    console.log("🔐 Starting real PKP signing process...");
    
    if (!this.isConnected) {
      await this.connect();
    }

    try {
      console.log("📝 Setting up Lit PKP signing...");
      console.log("  - Operation target:", operation.to);
      console.log("  - Operation value:", operation.value.toString());
      console.log("  - Chain ID:", chainId);
      console.log("  - UserOp Hash:", userOpHash);
      console.log("  - PKP Public Key:", this.pkpPublicKey.slice(0, 20) + "...");

      // Create session signatures for PKP signing
      console.log("🔑 Creating session signatures...");
      
      // Get auth signature for the wallet that owns the PKP
      const authSig = await generateAuthSig({
        signer: this.walletAccount,
        toSign: `I am creating a session to use PKP ${this.pkpPublicKey}`,
      });

      // For demonstration, we'll use a simplified session approach
      // In production, you'd properly configure the session signatures
      const sessionSigs: any = authSig;

      console.log("✅ Session signatures created successfully");

      // Prepare the message to sign (the operation hash)
      const toSign = userOpHash.startsWith('0x') ? userOpHash.slice(2) : userOpHash;
      const toSignArray = Array.from(new Uint8Array(Buffer.from(toSign, 'hex')));

      console.log("🔏 Calling Lit PKP sign...");
      
      // Use the pkpSign function as provided
      const signingResult = await this.litNodeClient.pkpSign({
        pubKey: this.pkpPublicKey,
        sessionSigs,
        toSign: toSignArray,
      });

      console.log("📋 PKP signing result:", signingResult);

      if (!signingResult || !signingResult.r || !signingResult.s) {
        throw new Error("Invalid PKP signing result - missing r or s values");
      }

      // Convert the PKP signature to Ethereum format
      const signature = this.formatPKPSignature(signingResult);
      
      console.log("✅ PKP signature generated successfully!");
      console.log("🔐 Signature:", signature.slice(0, 20) + "...");
      
      return {
        signature: signature as Hex,
        success: true,
      };
    } catch (error) {
      console.error("❌ Error signing operation with PKP:", error);
      return {
        signature: "0x" as Hex,
        success: false,
      };
    }
  }

  /**
   * Format PKP signature result into Ethereum signature format
   */
  private formatPKPSignature(signingResult: any): string {
    const { r, s, recid } = signingResult;
    
    // Ensure r and s are properly formatted as 32-byte hex strings
    const rHex = r.startsWith('0x') ? r : `0x${r}`;
    const sHex = s.startsWith('0x') ? s : `0x${s}`;
    
    // Convert recovery ID to v value (27 or 28 for Ethereum)
    const v = recid + 27;
    const vHex = v.toString(16).padStart(2, '0');
    
    // Combine r + s + v into a single signature
    return `${rHex}${sHex.slice(2)}${vHex}`;
  }

  /**
   * Combines ECDSA signature shares into a single signature
   */
  private combineSignatureShares(signatureShare: any): string {
    // The signature share should contain r, s, and v values
    const { r, s, recid } = signatureShare;
    
    // Convert to proper format
    const rHex = r.startsWith('0x') ? r : `0x${r}`;
    const sHex = s.startsWith('0x') ? s : `0x${s}`;
    const vHex = `0${recid + 27}`; // Recovery ID + 27 for Ethereum
    
    // Combine into a single signature
    return `${rHex}${sHex.slice(2)}${vHex}`;
  }

  /**
   * Validates that this executor can handle the given operation
   */
  validateOperation(operation: ExecuteOperation): boolean {
    // Basic validation
    if (!operation.to) {
      return false;
    }

    if (operation.value < BigInt(0)) {
      return false;
    }

    if (!operation.data) {
      return false;
    }

    return true;
  }

  /**
   * Gets the PKP address that will be signing operations
   */
  getPKPAddress(): Address {
    return this.pkpEthAddress;
  }

  /**
   * Gets the PKP public key
   */
  getPKPPublicKey(): string {
    return this.pkpPublicKey;
  }

  /**
   * Gets connection status
   */
  getConnectionStatus(): boolean {
    return this.isConnected;
  }
}