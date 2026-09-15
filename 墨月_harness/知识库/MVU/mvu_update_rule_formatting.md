---
id: mvu_update_rule_formatting
kind: task
group: MVU
domain: MVU
name: 📐_MVU-变量规则格式化
has_contract: true
---

# 📐_MVU-变量规则格式化

## 合同（本轮唯一执行依据）

<workshop_task id="mvu_update_rule_formatting">
  <mission>将作者确认的更新语义整理成完整变量更新规则YAML，字段与类型对照已保存的结构脚本和开局值。</mission>
  <knowledge>使用 knowledge_mvu_update_rule_formatting。结构由schema.js定义，实际初值来自initvar.yaml，更新条件来自确认的规则设计或指定的现有规则。</knowledge>
  <artifact>交付一个完整yaml代码块。条目名称、开关、位置与顺序由网页打包器处理，不输出其他MVU文件。</artifact>
  <units>核对结构、初值与更新要求；建立真实路径映射；合并相同规则；表达动态项目类型；生成精简check；检查YAML。</units>
  <boundaries>不增删或改型变量，不编造触发、幅度或集合规则；不列只读字段，不输出JSON Patch命令或可执行check。</boundaries>
  <validation>所有规则引用真实可更新字段；类型来自Schema；check与确认要求一致；YAML、路径和代码围栏完整。</validation>
  <stop>完整文件交付后停止。缺少信息只指出具体缺项；不因缺少旧设计标签拒绝已确认资料，不擅自修复上游决定。</stop>
</workshop_task>

## 知识

<knowledge_mvu_update_rule_formatting>
# MVU：生成变化规则文件

## 一、输入依据

读取网页自动带入的`schema.js`、`initvar.yaml`、已确认的变化规则设计和当前规则文件。普通问答也有这些固定关联资料，不要求作者复制。没有内部设计标签时，仍可使用作者确认的对话或指定的现有规则。

类型、层级、枚举与动态项目结构以已确认的Schema为准，实际起点以开局值为准，触发与变化方式采用作者确认的规则。资料冲突时明确指出哪一处需要确认，不任选一份覆盖另一份。首次创作缺少结构或开局文件时，先完成对应页签。

## 二、YAML结构

文件在网页名为`变量更新规则.yaml`，打包后的世界书条目是`[mvu_update]变量更新规则`，固定起始结构为：

```yaml
---
变量更新规则:
```

只写需要专门规则的字段；无特殊规则时保留上述空规则模板，不生成虚构条目。条目配置由打包器完成。

- 路径从真实顶层字段开始，不带`stat_data`外壳或JSON Pointer斜杠前缀。
- 同一对象的规则合理嵌套；同规则的固定字段可以合并为`${同类字段}`，不能掩盖规则差异。
- 动态映射以映射字段本身为键，不写`${未知动态键}`假路径；完整项目类型放入`type: |-`的TypeScript索引签名。
- 字符串省略`type`，数值写`type: number`，真假写`type: boolean`，固定选项用`type`填写Schema的完整字面量联合。
- 复合类型完整表达，不用object、省略号或开局空集合代替未来项目结构。
- format、range、category只在已确认要求需要时出现。

## 三、更新语义与路径核对

check使用精简、可执行判断的自然语言，不是JavaScript、表达式、伪代码或函数体。只采用确认的触发、保持、知情、幅度和集合增删条件，不夹带人设、初值、结构教程或JSON Patch示例。

`_`开头或仅代码维护的字段不列规则。规则路径对应Schema与开局数据的真实结构；动态对象未来项目类型由Schema提供，不要求为了检查临时塞入示例物品。要增加变量，先在“变量结构”确认；只是改初值则回“开局值”，不要让结构迁就错误的规则路径。

## 四、交付

输出一份完整yaml代码块，核对语法、路径、权限、类型与更新语义。实际未运行时不声称通过运行测试。复杂文件可以按顶层分组使用可清理的控制注释，但不是有效YAML的必需条件。

网页等待作者确认写入“变化规则”。确认后三份文件已齐，可以去“交叉检查”核对并进行本地运行。检查或运行是否通过，以实际结果为准。
</knowledge_mvu_update_rule_formatting>

