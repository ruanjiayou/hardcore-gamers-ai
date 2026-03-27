# robot

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run sdev
```

## TODO
- CPU 缓存对齐: CPU的伪共享(False Sharing), zobristTT 随机数表和置换表留至少 64 字节空隙
- 写个Perft函数：验证你的位运算和 Zobrist 是否在各种极端情况下都能保持一致
- 