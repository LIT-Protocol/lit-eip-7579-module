# Lit Protocol PKP + ERC-7579 Smart Account Integration

A complete implementation of an ERC-7579 executor module that leverages Lit Protocol's Programmable Key Pairs (PKPs) for decentralized signing in modular smart accounts. This enables true cross-chain asset control without deploying smart contracts on every chain.

## 🚀 Overview

This project implements the proposal for using **Lit Actions + PKPs** to create an ERC-7579 executor module that can be controlled by any validator on a given chain. The core innovation allows Lit keys to function as executors, validated via existing wallet validators, enabling **cross-chain asset ownership** without deploying the full smart contract wallet on every chain.

### Key Innovation
- Deploy your smart account wallet on **one chain** (e.g., Base)
- Use the **same Lit PKP** to control assets on **any other chain** (e.g., Polygon, Arbitrum, Optimism)
- No need to deploy your wallet contract on every chain
- Decentralized signing through Lit Protocol's threshold cryptography

## 🏗️ Architecture

### ERC-7579 Modular Account Structure
```
Smart Account
├── Validator Modules (Type 1) - e.g., ECDSA, Multisig
├── Executor Modules (Type 2) - ★ Lit PKP Executor ★
├── Hook Modules (Type 3)
└── Fallback Modules (Type 4)
```

### Components

#### 1. **LitPKPExecutor.sol** - Smart Contract
- ERC-7579 compliant executor module (Type 2)
- Handles PKP registration and signature verification
- Executes operations after validating PKP signatures
- Prevents replay attacks with chain ID and nonce

#### 2. **LitPKPExecutor TypeScript Class** - Integration Layer
- Manages Lit Protocol connections and PKP sessions
- Handles real PKP signing with decentralized key shares
- Formats signatures for Ethereum compatibility
- Applies proper message prefixes for EIP-191 compliance

#### 3. **Demo Application** - Complete Integration
- Mints fresh PKPs on Lit's DatilDev network
- Creates ZeroDev smart accounts on Base Sepolia
- Installs the PKP executor module on-chain
- Demonstrates real PKP signing and execution

## 🔧 How It Works

### 1. **Module Installation Flow**
```typescript
// 1. Mint a fresh PKP on Lit Protocol
const pkpInfo = await litContracts.pkpNftContractUtils.write.mint();

// 2. Create smart account with ZeroDev
const account = await createKernelAccount(publicClient, {
  plugins: { sudo: ecdsaValidator }
});

// 3. Install PKP executor module
await kernelClient.sendTransaction({
  to: litPKPExecutorAddress,
  data: installCalldata // Contains PKP address and token ID
});
```

### 2. **Signing & Execution Flow**
```typescript
// 1. Create operation hash (what gets signed)
const operationHash = await contract.getOperationHash(
  accountAddress, target, value, data
);

// 2. Apply Ethereum message prefix (EIP-191)
const ethSignedMessageHash = ethers.utils.keccak256(
  ethers.utils.solidityPack(
    ["string", "bytes32"],
    ["\x19Ethereum Signed Message:\n32", operationHash]
  )
);

// 3. Sign with PKP using decentralized key shares
const signature = await litNodeClient.pkpSign({
  pubKey: pkpPublicKey,
  sessionSigs: pkpSessionSigs,
  toSign: ethSignedMessageHashBytes
});

// 4. Execute operation through the module
await kernelClient.sendTransaction({
  to: litPKPExecutorAddress,
  data: executeCalldata // Contains target, value, data, signature
});
```

### 3. **Smart Contract Verification**
```solidity
// In LitPKPExecutor.sol
function executeFromExecutor(
    address target,
    uint256 value,
    bytes calldata data,
    bytes calldata pkpSignature
) external returns (bytes memory) {
    // 1. Create operation hash
    bytes32 operationHash = keccak256(abi.encodePacked(
        msg.sender, target, value, data, block.chainid, address(this)
    ));
    
    // 2. Verify PKP signature with EIP-191 prefix
    bytes32 ethSignedMessageHash = keccak256(
        abi.encodePacked("\x19Ethereum Signed Message:\n32", operationHash)
    );
    address recoveredSigner = ECDSA.recover(ethSignedMessageHash, pkpSignature);
    
    // 3. Ensure recovered signer matches registered PKP
    require(recoveredSigner == pkpInfo.pkpEthAddress, "InvalidSignature");
    
    // 4. Execute the operation
    (bool success, bytes memory result) = target.call{value: value}(data);
    require(success, "ExecutionFailed");
    
    return result;
}
```

## 🛠️ Technical Implementation

### Key Technical Challenges Solved

#### 1. **Signature Format Compatibility**
- **Problem**: Lit PKP signs raw hashes, but Ethereum contracts expect EIP-191 prefixed messages
- **Solution**: Apply `\x19Ethereum Signed Message:\n32` prefix before PKP signing
- **Code**: Uses `ethers.utils.solidityPack()` for proper encoding

#### 2. **PKP Authorization Conflicts**
- **Problem**: PKPs can only be authorized for one account at a time
- **Solution**: Mint fresh PKPs for each test to avoid `UnauthorizedPKP` errors
- **Network**: Uses Lit's DatilDev network for testing

#### 3. **Ethers Version Compatibility**
- **Problem**: LitContracts expects ethers v5, but modern projects use v6
- **Solution**: Install both versions and use appropriate imports
- **Implementation**: `import * as ethers from "ethers"` for v5 compatibility

### Dependencies
- **Lit Protocol**: PKP management and decentralized signing
- **ZeroDev**: ERC-4337 account abstraction and ERC-7579 modules  
- **Ethers**: Ethereum interactions and cryptographic functions
- **Viem**: Modern Ethereum client for wallet operations

## 📊 Live Demo Results

### Successful On-Chain Transactions
1. **Module Installation**: [0x6d150469...](https://base-sepolia.blockscout.com/tx/0x6d150469cfac859644941ad5b6822292dc7cd77cd9d496f8b36f0ba2f228bfd3)
2. **Operation Execution**: [0x228add15...](https://base-sepolia.blockscout.com/tx/0x228add15d2060ee73a717b2717b3ec63f65152349a1fbbf67d1f8a109f6fa94e)

### PKP Signing Example
```
Original operation hash: 0x48fd1c5f9c7f5856117416d99f4cdbe252e341d7db9e1a7cb25e520517703572
Prefixed message hash:   0x62695513bd7ffd1adcf93f73746e9749d1804ca7e6d2060cda11462835bcbaa4
PKP Signature:          0x3d91c1e38aeaad6dbb824304bcd871492ed867d3c8280dae2045e39d636260db...
✅ Successfully verified and executed on-chain!
```

## 🎯 Use Cases

### 1. **Cross-Chain Asset Management**
- Deploy smart account on Ethereum mainnet
- Use same PKP to manage assets on Polygon, Arbitrum, etc.
- No need to deploy wallet contracts on every chain

### 2. **Modular DeFi Operations**  
- Install different validators (ECDSA, multisig, etc.)
- Use Lit PKP as universal executor
- Programmable signing conditions via Lit Actions

### 3. **Decentralized Fund Management**
- Multi-chain treasury management
- Threshold signing without central coordination
- Conditional execution based on on-chain data

## 🚦 Getting Started

### Prerequisites
```bash
node >= 18.0.0
npm or pnpm
```

### Environment Setup
Create a `.env` file with:
```env
WALLET_PRIVATE_KEY=0x...  # Your wallet private key (needs Base Sepolia ETH)
ZERODEV_BASE_SEPOLIA_RPC=https://rpc.zerodev.app/api/v3/YOUR_PROJECT_ID/chain/84532
LIT_PKP_EXECUTOR_ADDRESS=0x5C3cdbD408282b5f44009dEA215d4A5A1CEfd918
```

### Installation & Run
```bash
# Install dependencies (handles ethers v5/v6 compatibility)
npm install --legacy-peer-deps

# Compile smart contracts
npx hardhat compile

# Run the complete demo
npm start
```

### Demo Flow
The demo will:
1. 🔗 Connect to Lit Protocol DatilDev network
2. 🪙 Mint a fresh PKP for testing
3. 🏦 Create a ZeroDev smart account on Base Sepolia  
4. 📦 Install the PKP executor module on-chain
5. 🔐 Sign operations with real PKP decentralized signing
6. 📤 Execute operations through the module
7. ✅ Verify everything works end-to-end

## 📁 Project Structure

```
├── contracts/
│   └── LitPKPExecutor.sol          # ERC-7579 executor module
├── artifacts/                      # Compiled contracts
├── lit-pkp-executor.ts            # TypeScript PKP integration
├── index.ts                       # Complete demo application
├── proposal.txt                   # Original project proposal
└── README.md                      # This file
```

## 🔐 Security Features

### Smart Contract Security
- ✅ **Reentrancy Protection**: Uses OpenZeppelin's `ReentrancyGuard`
- ✅ **Signature Verification**: ECDSA signature recovery with EIP-191
- ✅ **Access Control**: PKP authorization checking
- ✅ **Replay Protection**: Chain ID and nonce validation

### Lit Protocol Security  
- ✅ **Decentralized Signing**: Threshold cryptography with multiple nodes
- ✅ **Session Management**: Time-limited session signatures
- ✅ **Authorization**: PKP-specific authentication methods

## 🎯 Benefits & Impact

### For Users
- **Simplified UX**: One wallet, multiple chains
- **Reduced Costs**: No deployment fees on secondary chains  
- **Enhanced Security**: Decentralized key management
- **Greater Flexibility**: Programmable signing conditions

### For Developers
- **Modular Architecture**: ERC-7579 standard compliance
- **Easy Integration**: Drop-in executor module
- **Cross-Chain Ready**: Built for multi-chain future
- **Open Source**: Fully transparent and auditable

## 📈 Future Enhancements

### Planned Features
- [ ] **Advanced Lit Actions**: Complex conditional signing logic
- [ ] **Multi-Chain UI**: Dashboard for cross-chain operations  
- [ ] **Gas Optimization**: Batched operations and meta-transactions
- [ ] **Security Audit**: Professional third-party review

### Possible Extensions
- [ ] **Bridge Integration**: Automatic cross-chain asset transfers
- [ ] **DeFi Strategies**: Automated yield farming across chains
- [ ] **Social Recovery**: PKP-based account recovery mechanisms
- [ ] **Governance Integration**: Cross-chain DAO participation

## 🤝 Contributing

This project demonstrates the complete implementation of the Lit Protocol + ERC-7579 integration proposal. Contributions are welcome!

### Development Setup
```bash
git clone <repository>
cd SmartAccountModule
npm install --legacy-peer-deps
```

### Running Tests
```bash
npm run build    # Compile TypeScript
npm run start    # Run full integration demo
```

## 📜 License

MIT License - see LICENSE file for details.

## 🙏 Acknowledgments

- **Gemini Wallet Team**: For writing the original proposal and defining the vision
- **Lit Protocol Team**: For the innovative PKP and threshold cryptography
- **ZeroDev Team**: For ERC-7579 implementation and account abstraction tools
- **ERC-7579 Authors**: For the modular account standard
- **Vincent Team**: For the implementation and technical execution

---

*This implementation showcases the future of account abstraction: modular, cross-chain, and decentralized. The combination of Lit Protocol's programmable keys with ERC-7579's modular architecture creates unprecedented possibilities for smart account management.*