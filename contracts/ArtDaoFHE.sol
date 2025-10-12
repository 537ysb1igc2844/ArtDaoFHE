// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract ArtDaoFHE is SepoliaConfig {
    struct EncryptedProposal {
        uint256 id;
        euint32 encryptedArtwork;      // Encrypted artwork description
        euint32 encryptedLocation;     // Encrypted installation location
        euint32 encryptedArtistInfo;   // Encrypted artist information
        euint32 encryptedBudget;       // Encrypted proposed budget
        uint256 timestamp;
        uint256 voteCount;
    }
    
    struct DecryptedProposal {
        string artwork;
        string location;
        string artistInfo;
        string budget;
        bool isRevealed;
    }

    struct EncryptedVote {
        euint32 encryptedVote;        // Encrypted vote (1 for yes, 0 for no)
        euint32 encryptedWeight;      // Encrypted voting weight
    }

    uint256 public proposalCount;
    mapping(uint256 => EncryptedProposal) public encryptedProposals;
    mapping(uint256 => DecryptedProposal) public decryptedProposals;
    mapping(uint256 => mapping(address => EncryptedVote)) public encryptedVotes;
    
    mapping(string => euint32) private encryptedLocationCount;
    string[] private locationList;
    
    mapping(uint256 => uint256) private requestToProposalId;
    
    event ProposalSubmitted(uint256 indexed id, uint256 timestamp);
    event VoteCast(uint256 indexed proposalId, address indexed voter);
    event ProposalDecrypted(uint256 indexed id);
    
    modifier onlyMember() {
        _;
    }
    
    function submitEncryptedProposal(
        euint32 encryptedArtwork,
        euint32 encryptedLocation,
        euint32 encryptedArtistInfo,
        euint32 encryptedBudget
    ) public onlyMember {
        proposalCount += 1;
        uint256 newId = proposalCount;
        
        encryptedProposals[newId] = EncryptedProposal({
            id: newId,
            encryptedArtwork: encryptedArtwork,
            encryptedLocation: encryptedLocation,
            encryptedArtistInfo: encryptedArtistInfo,
            encryptedBudget: encryptedBudget,
            timestamp: block.timestamp,
            voteCount: 0
        });
        
        decryptedProposals[newId] = DecryptedProposal({
            artwork: "",
            location: "",
            artistInfo: "",
            budget: "",
            isRevealed: false
        });
        
        emit ProposalSubmitted(newId, block.timestamp);
    }
    
    function castEncryptedVote(
        uint256 proposalId,
        euint32 encryptedVote,
        euint32 encryptedWeight
    ) public onlyMember {
        require(proposalId <= proposalCount, "Invalid proposal");
        
        encryptedVotes[proposalId][msg.sender] = EncryptedVote({
            encryptedVote: encryptedVote,
            encryptedWeight: encryptedWeight
        });
        
        emit VoteCast(proposalId, msg.sender);
    }
    
    function requestProposalDecryption(uint256 proposalId) public onlyMember {
        EncryptedProposal storage proposal = encryptedProposals[proposalId];
        require(!decryptedProposals[proposalId].isRevealed, "Already decrypted");
        
        bytes32[] memory ciphertexts = new bytes32[](4);
        ciphertexts[0] = FHE.toBytes32(proposal.encryptedArtwork);
        ciphertexts[1] = FHE.toBytes32(proposal.encryptedLocation);
        ciphertexts[2] = FHE.toBytes32(proposal.encryptedArtistInfo);
        ciphertexts[3] = FHE.toBytes32(proposal.encryptedBudget);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptProposal.selector);
        requestToProposalId[reqId] = proposalId;
    }
    
    function decryptProposal(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 proposalId = requestToProposalId[requestId];
        require(proposalId != 0, "Invalid request");
        
        EncryptedProposal storage eProposal = encryptedProposals[proposalId];
        DecryptedProposal storage dProposal = decryptedProposals[proposalId];
        require(!dProposal.isRevealed, "Already decrypted");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        string[] memory results = abi.decode(cleartexts, (string[]));
        
        dProposal.artwork = results[0];
        dProposal.location = results[1];
        dProposal.artistInfo = results[2];
        dProposal.budget = results[3];
        dProposal.isRevealed = true;
        
        if (FHE.isInitialized(encryptedLocationCount[dProposal.location]) == false) {
            encryptedLocationCount[dProposal.location] = FHE.asEuint32(0);
            locationList.push(dProposal.location);
        }
        encryptedLocationCount[dProposal.location] = FHE.add(
            encryptedLocationCount[dProposal.location], 
            FHE.asEuint32(1)
        );
        
        emit ProposalDecrypted(proposalId);
    }
    
    function getDecryptedProposal(uint256 proposalId) public view returns (
        string memory artwork,
        string memory location,
        string memory artistInfo,
        string memory budget,
        bool isRevealed
    ) {
        DecryptedProposal storage p = decryptedProposals[proposalId];
        return (p.artwork, p.location, p.artistInfo, p.budget, p.isRevealed);
    }
    
    function getEncryptedLocationCount(string memory location) public view returns (euint32) {
        return encryptedLocationCount[location];
    }
    
    function requestLocationCountDecryption(string memory location) public {
        euint32 count = encryptedLocationCount[location];
        require(FHE.isInitialized(count), "Location not found");
        
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(count);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptLocationCount.selector);
        requestToProposalId[reqId] = bytes32ToUint(keccak256(abi.encodePacked(location)));
    }
    
    function decryptLocationCount(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 locationHash = requestToProposalId[requestId];
        string memory location = getLocationFromHash(locationHash);
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32 count = abi.decode(cleartexts, (uint32));
    }
    
    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }
    
    function getLocationFromHash(uint256 hash) private view returns (string memory) {
        for (uint i = 0; i < locationList.length; i++) {
            if (bytes32ToUint(keccak256(abi.encodePacked(locationList[i]))) == hash) {
                return locationList[i];
            }
        }
        revert("Location not found");
    }
}