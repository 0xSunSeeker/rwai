// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IMerchantMoeRouter
/// @notice Uniswap V2-compatible interface for the MoeRouter on Mantle Mainnet
/// @dev Deployed at 0xeaEE7EE68874218c3558b40063c42B82D3E7232a
interface IMerchantMoeRouter {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function swapTokensForExactTokens(
        uint256 amountOut,
        uint256 amountInMax,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function getAmountsOut(
        uint256 amountIn,
        address[] calldata path
    ) external view returns (uint256[] memory amounts);

    function getAmountsIn(
        uint256 amountOut,
        address[] calldata path
    ) external view returns (uint256[] memory amounts);

    function factory() external pure returns (address);

    function WETH() external pure returns (address);
}
