import { CREATION_SHOT_FACT_GROUPS } from "./lib/creationTags.js";

const placeholderNotice = "虚构筛选测试资料；封面为布局占位图。";
const videoNotice = "视频仅用于播放器测试，画面不对应虚构场景。";

// These are authored plans for testing tags, rather than observations of the supplied media.
const scenarios = [
  {
    title: "第一视角剑盾重击",
    scene: "人物在雨夜废墟中举盾格挡怪兽，再以剑蓄力重击；镜头贴近持剑双手，雷电和冲击波突出力量与临场感。",
    technique: "仰拍配合轻微手持；从盾牌切入剑刃细节，以动作衔接接上重击，先停顿蓄力，再慢动作展示接触瞬间。",
    facts: { 景别: "近景", 运镜: "手持镜头", 构图: "居中构图", 光影: "硬光" },
    tagValues: {
      subject: ["人物", "怪兽"], props: ["剑", "盾牌"],
      action: ["蓄力", "重击", "格挡"], intent: ["力量感", "临场感", "冲击感"],
      viewpoint: ["第一视角"], environment: ["室外", "废墟", "夜晚", "雨天"],
      effects: ["雷电", "冲击波", "火花"], angle: ["仰拍"], focus: ["浅景深"],
      "shot-purpose": ["动作展示", "细节强调"], blocking: ["对峙", "接近"],
      editing: ["动作衔接", "切入细节"], time: ["慢动作"], rhythm: ["停顿蓄力", "密集爆发"],
      type: ["故事片"], emotion: ["紧张"],
    },
  },
  {
    title: "第一视角拔刀闪避",
    scene: "人物在城市雨巷拔刀，劈开障碍后闪避追赶者；只使用刀，不出现剑，第一视角随着奔跑和跳跃冲过狭窄空间。",
    technique: "倾斜机位跟随前进，路边物件形成前景遮挡；以运动方向匹配和遮挡转场串联动作，速度渐变制造快慢交替。",
    facts: { 景别: "中景", 运镜: "跟镜头", 构图: "前景遮挡", 光影: "蓝调时刻" },
    tagValues: {
      subject: ["人物"], props: ["刀"], action: ["拔刀", "劈砍", "闪避", "奔跑", "跳跃", "追逐"],
      intent: ["速度感", "紧张感"], viewpoint: ["第一视角"],
      environment: ["室外", "城市街道", "狭窄空间", "雨天"], effects: ["拖影", "液体飞溅"],
      angle: ["倾斜机位"], focus: ["深焦"], "shot-purpose": ["动作展示"],
      blocking: ["纵深移动", "出画"], editing: ["运动方向匹配", "遮挡转场"],
      time: ["速度渐变"], rhythm: ["快慢交替"], type: ["短片"], emotion: ["紧张"],
    },
  },
  {
    title: "第三视角雪原剑击",
    scene: "第三视角观看人物举剑与巨大化的怪兽对峙，盾牌挡住冲击后回身重击，把对方击飞；雪地和雪天强化双方体量差。",
    technique: "仰拍双人同框后拉镜头交代距离；正反打配合反应镜头展示人物反应，接触瞬间使用子弹时间，随后收束余韵。",
    facts: { 景别: "全景", 运镜: "拉镜头", 构图: "双人同框", 光影: "自然光" },
    tagValues: {
      subject: ["人物", "怪兽"], props: ["剑", "盾牌"], action: ["重击", "格挡", "击飞"],
      transformation: ["巨大化"], intent: ["巨大感", "压迫感", "力量感"], viewpoint: ["第三视角"],
      environment: ["室外", "雪地", "白天", "雪天"], effects: ["冰冻", "碎裂", "冲击波"],
      angle: ["仰拍"], focus: ["深焦"], "shot-purpose": ["交代关系", "人物反应"],
      blocking: ["对峙", "远离"], editing: ["正反打", "反应镜头"], time: ["子弹时间"],
      rhythm: ["密集爆发", "收束余韵"], type: ["动画"], emotion: ["紧张"],
    },
  },
  {
    title: "林间双刀连击",
    scene: "人物在晨雾森林持双刀连续回旋劈砍，踢击后投掷短刀；对手与主角交换位置，发光刀轨和拖影强调速度与优雅。",
    technique: "环绕镜头保持人物位于三分线，浅景深隔开树林；视线匹配交代对手方位，快动作的连击逐步加速。",
    facts: { 景别: "全景", 运镜: "环绕镜头", 构图: "三分构图", 光影: "黄金时刻" },
    tagValues: {
      subject: ["人物"], props: ["双刀"], action: ["连击", "劈砍", "踢击", "投掷"],
      intent: ["速度感", "优雅感"], viewpoint: ["第三视角"],
      environment: ["室外", "森林", "白天", "雾天"], effects: ["发光", "拖影"],
      angle: ["平视"], focus: ["浅景深"], "shot-purpose": ["动作展示"],
      blocking: ["位置交换"], editing: ["视线匹配", "动作衔接"], time: ["快动作"],
      rhythm: ["逐步加速"], type: ["动画"], emotion: ["希望"],
    },
  },
  {
    title: "机甲装甲展开",
    scene: "人物在室内机库机械化，机器人骨架逐层展开为机甲装甲，再起飞离开机库；能量光束、火花与发光接缝体现力量。",
    technique: "升降镜头由脚部升至头部，以对称构图和逆光强调轮廓；形状匹配衔接机械零件，声音先入提示启动，再逐步加速。",
    facts: { 景别: "中景", 运镜: "升降镜头", 构图: "对称构图", 光影: "逆光" },
    tagValues: {
      subject: ["人物", "机器人", "机甲"], action: ["登场", "飞行"],
      transformation: ["机械化", "装甲展开"], intent: ["力量感", "巨大感"], viewpoint: ["第三视角"],
      environment: ["室内", "空中"], effects: ["能量光束", "火花", "发光"],
      angle: ["仰拍"], focus: ["焦点转移"], "shot-purpose": ["人物出场", "信息揭示"],
      blocking: ["入画", "纵深移动"], editing: ["形状匹配", "声音先入"], time: ["速度渐变"],
      rhythm: ["逐步加速"], type: ["广告"], emotion: ["希望"],
    },
  },
  {
    title: "兽化分身追逐",
    scene: "人物在雾夜森林完成兽化，化作动物形态的怪兽并分身追逐；前景与远处的分身轮流奔跑、跳跃，尾迹带着火焰。",
    technique: "穿越镜头经过树枝与分身之间，纵深分层交代前后景互动；交叉剪辑对照不同追逐路线，音乐卡点强化密集爆发。",
    facts: { 景别: "远景", 运镜: "穿越镜头", 构图: "纵深分层", 光影: "硬光" },
    tagValues: {
      subject: ["人物", "动物", "怪兽"], action: ["奔跑", "跳跃", "追逐"],
      transformation: ["人物变身", "兽化", "分身"], intent: ["速度感", "神秘感", "压迫感"],
      viewpoint: ["第三视角"], environment: ["室外", "森林", "夜晚", "雾天"], effects: ["火焰", "拖影"],
      angle: ["平视"], focus: ["深焦"], "shot-purpose": ["动作展示", "悬念隐藏"],
      blocking: ["前后景互动", "群体调度"], editing: ["交叉剪辑", "音乐卡点"],
      time: ["快动作"], rhythm: ["密集爆发"], type: ["故事片"], emotion: ["紧张"],
    },
  },
  {
    title: "监控中的机器人交火",
    scene: "固定监控视角俯看室内狭窄通道，机器人持枪械与盾牌交火；碰撞引发局部爆炸，火花、烟尘和碎裂物遮住出口。",
    technique: "门框形成框中框，深焦保留通道前后人物关系；硬切切换监控点位，跳切省略等待，时间静止用于观察爆炸瞬间。",
    facts: { 景别: "大远景", 运镜: "固定镜头", 构图: "框中框", 光影: "硬光" },
    tagValues: {
      subject: ["机器人", "建筑"], props: ["枪械", "盾牌"], action: ["格挡", "碰撞", "爆炸"],
      intent: ["紧张感", "压迫感"], viewpoint: ["监控视角"], environment: ["室内", "狭窄空间"],
      effects: ["火花", "烟尘", "碎裂"], angle: ["俯拍"], focus: ["深焦"],
      "shot-purpose": ["建立环境", "交代关系", "悬念隐藏"], blocking: ["纵深移动", "群体调度"],
      editing: ["硬切", "跳切"], time: ["时间静止", "时间省略"], rhythm: ["停顿蓄力", "密集爆发"],
      type: ["短片"], emotion: ["紧张"],
    },
  },
  {
    title: "沙漠长枪骑行",
    scene: "人物骑动物持长枪穿过白天沙漠，奔跑登场后向靶标刺击，再投出长枪；烟尘让移动方向与速度清楚可见。",
    technique: "航拍大远景以负空间交代广阔环境，俯拍保留路线；平行剪辑对照骑行者与靶标，长镜头延续舒缓铺陈。",
    facts: { 景别: "大远景", 运镜: "航拍", 构图: "负空间", 光影: "黄金时刻" },
    tagValues: {
      subject: ["人物", "动物"], props: ["长枪"], action: ["登场", "奔跑", "刺击", "投掷"],
      intent: ["速度感", "孤独感"], viewpoint: ["第三视角"], environment: ["室外", "沙漠", "白天"],
      effects: ["烟尘"], angle: ["俯拍"], focus: ["深焦"], "shot-purpose": ["建立环境", "人物出场"],
      blocking: ["入画", "纵深移动"], editing: ["平行剪辑", "运动方向匹配"], time: ["长镜头"],
      rhythm: ["舒缓铺陈"], type: ["故事片"], emotion: ["孤独"],
    },
  },
  {
    title: "冰斧劈砍细节",
    scene: "人物在雪天雪地蓄力，用斧劈砍冰冻障碍；特写记录斧刃接触后的碎裂，寒冷环境中的握持细节体现力量。",
    technique: "推镜头从手部推近斧刃，焦点转移由刃口到冰片；切入细节后重复呈现接触瞬间，慢动作延长碎裂观察时间。",
    facts: { 景别: "特写", 运镜: "推镜头", 构图: "三分构图", 光影: "柔光" },
    tagValues: {
      subject: ["人物"], props: ["斧"], action: ["蓄力", "劈砍", "重击"],
      intent: ["力量感", "冲击感"], viewpoint: ["第三视角"], environment: ["室外", "雪地", "白天", "雪天"],
      effects: ["冰冻", "碎裂"], angle: ["平视"], focus: ["焦点转移", "浅景深"],
      "shot-purpose": ["细节强调", "动作展示"], editing: ["切入细节", "动作衔接"],
      time: ["慢动作", "重复呈现"], rhythm: ["停顿蓄力"], type: ["动画"], emotion: ["紧张"],
    },
  },
  {
    title: "废墟巨锤冲击",
    scene: "巨大机甲在废墟举锤重击建筑，盾牌挡下飞溅碎块，冲击波把障碍击飞并引发爆炸；建筑比例强调巨大感。",
    technique: "仰拍居中机甲，用滑动变焦改变背景透视来制造压迫；硬切接反应镜头，子弹时间表现冲击后的空间关系。",
    facts: { 景别: "中景", 运镜: "滑动变焦", 构图: "居中构图", 光影: "硬光" },
    tagValues: {
      subject: ["机甲", "建筑"], props: ["锤", "盾牌"], action: ["重击", "击飞", "爆炸"],
      intent: ["巨大感", "压迫感", "冲击感"], viewpoint: ["第三视角"], environment: ["室外", "废墟", "白天"],
      effects: ["冲击波", "碎裂", "烟尘"], angle: ["仰拍"], focus: ["深焦"],
      "shot-purpose": ["动作展示", "人物反应"], blocking: ["接近"], editing: ["硬切", "反应镜头"],
      time: ["子弹时间"], rhythm: ["密集爆发"], type: ["动画"], emotion: ["紧张"],
    },
  },
  {
    title: "森林弓箭与视线",
    scene: "人物在森林持弓箭蓄力瞄准，远处动物从树林中入画后远离；镜头交代持弓者和目标之间的关系，保留临场紧张。",
    technique: "平视横移镜头维持过肩构图，焦点由持弓者转移到远处动物；视线匹配连接目标，再以声音延续保持注意力。",
    facts: { 景别: "中景", 运镜: "横移镜头", 构图: "过肩构图", 光影: "自然光" },
    tagValues: {
      subject: ["人物", "动物", "植物"], props: ["弓箭"], action: ["蓄力", "登场"],
      intent: ["临场感", "紧张感"], viewpoint: ["第三视角"], environment: ["室外", "森林", "白天"],
      angle: ["平视"], focus: ["焦点转移"], "shot-purpose": ["交代关系", "人物反应"],
      blocking: ["入画", "远离"], editing: ["视线匹配", "声音延续"], time: ["长镜头"],
      rhythm: ["停顿蓄力"], type: ["故事片"], emotion: ["紧张"],
    },
  },
  {
    title: "太空法杖失重",
    scene: "人物持法杖漂浮在太空，能量光束和雷电穿过空中，发光粒子渐渐消散；悬浮飞行体现失重感与神秘感。",
    technique: "平视摇镜头寻找人物，负空间保留孤独比例；时间静止让粒子悬停，再叠化至运动恢复，节奏收束余韵。",
    facts: { 景别: "远景", 运镜: "摇镜头", 构图: "负空间", 光影: "逆光" },
    tagValues: {
      subject: ["人物", "抽象物体"], props: ["法杖"], action: ["飞行"], transformation: ["消散"],
      intent: ["失重感", "神秘感", "孤独感"], viewpoint: ["第三视角"], environment: ["太空", "空中"],
      effects: ["能量光束", "雷电", "发光", "粒子消散"], angle: ["平视"], focus: ["浅景深"],
      "shot-purpose": ["建立环境", "信息揭示"], blocking: ["远离", "出画"], editing: ["叠化", "淡入淡出"],
      time: ["时间静止"], rhythm: ["收束余韵"], type: ["实验影像"], emotion: ["孤独", "宁静"],
    },
  },
  {
    title: "绳索跃出与坠落",
    scene: "人物背着日常背包从狭窄平台奔跑、跳跃后坠落，绳索逐渐绷紧；雾天看不到谷底，失重感和紧张感持续上升。",
    technique: "顶拍转倾斜机位，甩镜头跟随人物离开平台，前景遮挡暂时隐藏绳索；甩镜转场配合速度渐变，再慢动作揭示绳索绷紧。",
    facts: { 景别: "近景", 运镜: "甩镜头", 构图: "前景遮挡", 光影: "自然光" },
    tagValues: {
      subject: ["人物"], props: ["绳索", "日常物件"], action: ["奔跑", "跳跃", "坠落"],
      intent: ["失重感", "紧张感"], viewpoint: ["第三视角"], environment: ["室外", "狭窄空间", "雾天", "空中"],
      angle: ["顶拍", "倾斜机位"], focus: ["由虚到实"], "shot-purpose": ["悬念隐藏", "信息揭示"],
      blocking: ["出画", "远离"], editing: ["甩镜转场"], time: ["速度渐变", "慢动作"],
      rhythm: ["快慢交替"], type: ["短片"], emotion: ["紧张"],
    },
  },
  {
    title: "产品缩小与重组",
    scene: "室内桌面的日常水壶产品物体变形，缩小成发光碎片后消散，再重组回完整水壶；液体飞溅和粒子消散展示变化过程。",
    technique: "固定镜头以对称构图拍摄大特写，浅景深突出材质；形状匹配连接产品轮廓，倒放和重复呈现比较重组过程。",
    facts: { 景别: "大特写", 运镜: "固定镜头", 构图: "对称构图", 光影: "柔光" },
    tagValues: {
      subject: ["产品", "抽象物体"], props: ["日常物件"], transformation: ["物体变形", "缩小", "消散", "重组"],
      intent: ["神秘感", "优雅感"], viewpoint: ["第三视角"], environment: ["室内", "白天"],
      effects: ["液体飞溅", "粒子消散", "发光"], angle: ["平视"], focus: ["浅景深"],
      "shot-purpose": ["细节强调", "信息揭示"], editing: ["形状匹配", "切入细节"],
      time: ["倒放", "重复呈现"], rhythm: ["快慢交替"], type: ["广告"], emotion: ["希望"],
    },
  },
  {
    title: "雨街车辆碰撞",
    scene: "两辆车辆在雨天城市街道碰撞，局部爆炸带来火焰、烟尘与碎裂，路面积水产生液体飞溅；拖影强调速度和冲击。",
    technique: "跟镜头沿街道纵深分层前进，倾斜机位强化不稳定；交叉剪辑连接两条行驶路线，运动方向匹配保持方向，撞击前停顿蓄力。",
    facts: { 景别: "全景", 运镜: "跟镜头", 构图: "纵深分层", 光影: "蓝调时刻" },
    tagValues: {
      subject: ["车辆", "建筑"], action: ["碰撞", "爆炸"], intent: ["速度感", "冲击感", "紧张感"],
      viewpoint: ["第三视角"], environment: ["室外", "城市街道", "雨天"],
      effects: ["火焰", "烟尘", "碎裂", "液体飞溅", "拖影"], angle: ["倾斜机位"], focus: ["深焦"],
      "shot-purpose": ["动作展示", "交代关系"], blocking: ["接近", "位置交换"],
      editing: ["交叉剪辑", "运动方向匹配"], time: ["速度渐变"], rhythm: ["停顿蓄力", "密集爆发"],
      type: ["故事片"], emotion: ["紧张"],
    },
  },
  {
    title: "舞蹈换装与分身",
    scene: "人物在室内暖光舞台舞蹈，经过日常衣架时换装，分身组成舞群；舞者入画、出画和位置交换带来温暖、优雅的表演。",
    technique: "固定中景居中观看群体调度，焦点随前后景互动转移；音乐卡点完成换装，跳切省略换装过程，平行剪辑比较两个分身。",
    facts: { 景别: "中景", 运镜: "固定镜头", 构图: "居中构图", 光影: "室内暖光" },
    tagValues: {
      subject: ["人物"], props: ["日常物件"], action: ["舞蹈", "登场"], transformation: ["换装", "分身"],
      intent: ["优雅感", "温暖感"], viewpoint: ["第三视角"], environment: ["室内", "夜晚"],
      angle: ["平视"], focus: ["焦点转移"], "shot-purpose": ["人物出场", "动作展示"],
      blocking: ["入画", "出画", "位置交换", "群体调度", "前后景互动"],
      editing: ["音乐卡点", "跳切", "平行剪辑"], time: ["时间省略"], rhythm: ["逐步加速", "收束余韵"],
      type: ["广告"], emotion: ["温暖", "治愈", "希望"],
    },
  },
  {
    title: "温室植物的季节",
    scene: "植物在室内温室和室外庭院经历生长与枯萎，建筑窗线提供季节参照；拟定纪录片段记录自然变化，表达宁静、治愈和温暖。",
    technique: "固定全景留出负空间，深焦建立环境；快动作与时间省略表现季节变化，倒放作为明确的生长实验段落，叠化连接阶段。",
    facts: { 景别: "全景", 运镜: "固定镜头", 构图: "负空间", 光影: "自然光" },
    tagValues: {
      subject: ["植物", "建筑"], transformation: ["物体变形"], intent: ["温暖感", "优雅感"],
      viewpoint: ["第三视角"], environment: ["室内", "室外", "白天"], angle: ["平视"], focus: ["深焦"],
      "shot-purpose": ["建立环境", "细节强调"], editing: ["叠化", "淡入淡出"],
      time: ["快动作", "时间省略", "倒放"], rhythm: ["舒缓铺陈", "收束余韵"],
      type: ["纪录片"], emotion: ["宁静", "治愈", "温暖"],
    },
  },
  {
    title: "水下动物穿行",
    scene: "动物鱼群在白天水下穿过植物，捕食者追逐时鱼群向远处散开；拟定纪录片段先交代鱼群关系，再观察近处动物反应。",
    technique: "推镜头在三分构图中靠近鱼群，深焦保持水草层次；视线匹配配合反应镜头，长镜头保留舒缓铺陈。",
    facts: { 景别: "远景", 运镜: "推镜头", 构图: "三分构图", 光影: "自然光" },
    tagValues: {
      subject: ["动物", "植物"], action: ["登场", "追逐"], intent: ["临场感", "神秘感"],
      viewpoint: ["第三视角"], environment: ["水下", "白天"], angle: ["平视"], focus: ["深焦"],
      "shot-purpose": ["建立环境", "交代关系", "人物反应"], blocking: ["入画", "远离", "群体调度"],
      editing: ["视线匹配", "反应镜头"], time: ["长镜头"], rhythm: ["舒缓铺陈"],
      type: ["纪录片"], emotion: ["宁静", "治愈"],
    },
  },
  {
    title: "雨窗里的回忆与未来",
    scene: "人物在城市夜晚的室内望向雨窗，建筑与日常茶杯留在室内暖光中；故事通过闪回旧日和闪前未来表达怀旧、孤独与希望。",
    technique: "特写透过窗框观看人物，由虚到实再由实到虚转向倒影；声音先入带来回忆，声音延续接上闪前，叠化形成收束余韵。",
    facts: { 景别: "特写", 运镜: "固定镜头", 构图: "框中框", 光影: "室内暖光" },
    tagValues: {
      subject: ["人物", "建筑", "产品"], props: ["日常物件"], action: ["登场"],
      intent: ["孤独感", "温暖感"], viewpoint: ["第三视角"], environment: ["室内", "城市街道", "夜晚", "雨天"],
      angle: ["平视"], focus: ["由虚到实", "由实到虚", "浅景深"],
      "shot-purpose": ["人物反应", "信息揭示", "悬念隐藏"], blocking: ["接近", "入画"],
      editing: ["声音先入", "声音延续", "叠化"], time: ["闪回", "闪前"], rhythm: ["收束余韵"],
      type: ["故事片"], emotion: ["怀旧", "孤独", "希望", "温暖"],
    },
  },
  {
    title: "液体形状实验",
    scene: "室内实验影像把液体视作抽象物体，发光液滴物体变形、缩小、消散并重组，液体飞溅留下拖影；强调优雅与失重感。",
    technique: "顶拍大特写横移镜头观察形态，由实到虚隐藏下一种形状，再由虚到实揭示；形状匹配和硬切对照实验，倒放与时间静止比较流动过程。",
    facts: { 景别: "大特写", 运镜: "横移镜头", 构图: "居中构图", 光影: "硬光" },
    tagValues: {
      subject: ["抽象物体"], transformation: ["物体变形", "缩小", "消散", "重组"],
      intent: ["优雅感", "失重感", "神秘感"], viewpoint: ["第三视角"], environment: ["室内"],
      effects: ["液体飞溅", "粒子消散", "发光", "拖影"], angle: ["顶拍"],
      focus: ["由实到虚", "由虚到实"], "shot-purpose": ["细节强调", "信息揭示", "悬念隐藏"],
      editing: ["形状匹配", "硬切"], time: ["倒放", "时间静止", "重复呈现"],
      rhythm: ["快慢交替"], type: ["实验影像"], emotion: ["宁静", "治愈"],
    },
  },
];

const videoPairs = [[0, 19], [1, 2], [3, 5], [4, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 18], [16, 17]];
const exampleId = (prefix, index) => `${prefix}-${String(index + 1).padStart(2, "0")}`;

function frameTags(scenario) {
  const { type, emotion, ...tagValues } = scenario.tagValues;
  const { movement, lighting, ...factTagGroups } = Object.fromEntries(
    Object.entries(CREATION_SHOT_FACT_GROUPS).map(([groupId, fact]) => [groupId, [scenario.facts[fact]]]),
  );
  return { type, emotion, movement, lighting, tagValues: { ...tagValues, ...factTagGroups } };
}

function plannedShot(scenario, image, id, start, end) {
  return {
    id, start, end, image,
    title: `筛选示例 · ${scenario.title}`,
    summary: `${placeholderNotice}${videoNotice}${scenario.scene}`,
    facts: { ...scenario.facts },
    tagValues: Object.fromEntries(Object.entries(scenario.tagValues).map(([key, values]) => [key, [...values]])),
    analysis: [{ label: "拟定镜头方案", text: `${scenario.technique}这些内容仅用于验证分类，不是对所附视频的分析结论。` }],
    imagePrompt: `虚构画面方案：${scenario.scene}${scenario.technique}`,
    videoPrompt: `虚构动态方案：${scenario.scene}${scenario.technique}`,
  };
}

export function createFilterExamples(images, videoSrc, durationSeconds = 32.323) {
  if (!Array.isArray(images) || images.length !== scenarios.length) {
    throw new Error("筛选示例需要按 masonry-demo-01..20 顺序提供 20 张现有封面。");
  }
  const frames = scenarios.map((scenario, index) => ({
    id: exampleId("masonry-demo", index),
    kind: "分镜",
    title: `筛选示例 · ${scenario.title}`,
    image: images[index],
    duration: "00:08",
    description: `${placeholderNotice}${scenario.scene}${scenario.technique}`,
    prompt: `虚构镜头创作方案：${scenario.scene}${scenario.technique}`,
    ...frameTags(scenario),
  }));
  const halfway = durationSeconds / 2;
  const videos = videoPairs.map(([openingIndex, actionIndex], index) => {
    const opening = scenarios[openingIndex];
    const action = scenarios[actionIndex];
    return {
      id: exampleId("filter-demo-video", index),
      kind: "视频",
      title: `筛选示例 · ${opening.title} / ${action.title}`,
      image: images[openingIndex],
      description: `${placeholderNotice}${videoNotice}两段虚构镜头方案分别为：${opening.scene}${action.scene}`,
      prompt: `仅测试镜头分类与组合筛选。前段拟定为${opening.scene}后段拟定为${action.scene}`,
      video: {
        src: videoSrc,
        durationSeconds,
        isMock: true,
        shots: [
          plannedShot(opening, images[openingIndex], "test-opening", 0, halfway),
          plannedShot(action, images[actionIndex], "test-action", halfway, durationSeconds),
        ],
      },
    };
  });
  return [...frames, ...videos];
}
