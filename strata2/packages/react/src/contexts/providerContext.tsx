import { AnchorProvider } from "@coral-xyz/anchor";
import { useAnchorWallet, useConnection, useWallet } from "@solana/wallet-adapter-react";
import { ConfirmOptions, sendAndConfirmRawTransaction, Signer, Transaction } from "@solana/web3.js";
import React from "react";
import {Wallet} from '@coral-xyz/anchor'
import { Keypair } from "@solana/web3.js";
export const ProviderContext = React.createContext<{
  provider?: AnchorProvider;
  awaitingApproval: boolean;
}>({
  awaitingApproval: false,
});

export const ProviderContextProvider: React.FC<React.PropsWithChildren<{}>> = ({ children }) => {
  const { connection } = useConnection();
  const [awaitingApproval, setAwaitingApproval] = React.useState(false);
const wallet = useAnchorWallet();
// @ts-ignore
const provider = new AnchorProvider(connection, wallet, {});
  return (
    <ProviderContext.Provider value={{ awaitingApproval , provider}}>
      {children}
    </ProviderContext.Provider>
  );
};
